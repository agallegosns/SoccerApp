import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { Simulation } from '../../engine/index.ts';
import type { RenderMeta } from './render.ts';
import { SAMPLE_RATE, buildAudio } from '../sound/synth.ts';
import { drawVideoFrame, type VideoStyle } from './renderers.ts';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from './theme.ts';

interface Props {
  readonly sim: Simulation;
  readonly meta: RenderMeta;
  readonly label: string;
  readonly style: VideoStyle;
  /** Cambia cuando se sube o quita un escudo: fuerza a redibujar. */
  readonly crestVersion: number;
  /** Posición solicitada desde fuera (p. ej. al pulsar un suceso). `nonce` fuerza el salto aunque el valor se repita. */
  readonly seek: { readonly t: number; readonly nonce: number } | null;
}

const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Vista previa en canvas 1080×1920 con reproducción, pausa y barra de posición. Remontar (key) al cambiar de simulación. */
export function SimulationPreview({ sim, meta, label, style, crestVersion, seek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [time, setTime] = useState(0);
  const [reduced] = useState(prefersReducedMotion);
  const [wantsPlay, setWantsPlay] = useState(!reduced);
  const [seenNonce, setSeenNonce] = useState(seek?.nonce ?? 0);
  const [soundOn, setSoundOn] = useState(false);
  const timeRef = useRef(0);
  useEffect(() => {
    timeRef.current = time;
  }, [time]);
  const duration = sim.script.duration;
  const playing = wantsPlay && time < duration;

  if (seek !== null && seek.nonce !== seenNonce) {
    // Salto pedido desde fuera: se aplica durante el render (patrón recomendado por React para derivar estado de props).
    setSeenNonce(seek.nonce);
    setTime(Math.min(Math.max(seek.t, 0), duration));
  }

  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => Math.min(duration, t + dt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [playing, duration]);

  const audio = useMemo(() => (soundOn ? buildAudio(sim, style) : null), [soundOn, sim, style]);
  const audioCtx = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (audio === null || !playing || typeof AudioContext === 'undefined') return undefined;
    audioCtx.current ??= new AudioContext({ sampleRate: SAMPLE_RATE });
    const ctx = audioCtx.current;
    const buffer = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.copyToChannel(audio.samples, 0);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    void ctx.resume().then(() => {
      node.start(0, Math.min(timeRef.current, duration - 0.01));
    }).catch((error: unknown) => {
      console.warn('No se pudo reproducir el sonido', error);
    });
    return () => {
      try {
        node.stop();
      } catch {
        // `stop()` lanza si aún no se inició; no hay nada que detener.
        node.disconnect();
      }
    };
  }, [audio, playing, duration, seenNonce]);
  useEffect(() => () => {
    void audioCtx.current?.close();
  }, []);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx === null || ctx === undefined) return;
    drawVideoFrame(ctx, sim, time, meta, style);
  }, [sim, time, meta, style, crestVersion]);

  return (
    <div className="preview">
      <canvas ref={canvasRef} className="preview__canvas" width={VIDEO_WIDTH} height={VIDEO_HEIGHT} role="img" aria-label={label} data-testid="preview-canvas" />
      <div className="preview__controls">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            if (playing) {
              setWantsPlay(false);
              return;
            }
            if (time >= duration) setTime(0);
            setWantsPlay(true);
          }}
          aria-label={playing ? 'Pausar' : 'Reproducir'}
          data-testid="play-toggle"
        >
          {playing ? <Pause aria-hidden="true" size={20} /> : <Play aria-hidden="true" size={20} />}
          {playing ? 'Pausar' : 'Reproducir'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setTime(0);
            setWantsPlay(true);
          }}
          aria-label="Volver al principio"
        >
          <RotateCcw aria-hidden="true" size={20} />
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => { setSoundOn((v) => !v); }}
          aria-pressed={soundOn}
          aria-label={soundOn ? 'Silenciar la vista previa' : 'Activar el sonido de la vista previa'}
          data-testid="sound-toggle"
        >
          {soundOn ? <Volume2 aria-hidden="true" size={20} /> : <VolumeX aria-hidden="true" size={20} />}
        </button>
        <label className="preview__scrub">
          <span className="visually-hidden">Posición del vídeo</span>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={time}
            onChange={(e) => {
              setWantsPlay(false);
              setTime(Number(e.target.value));
            }}
            data-testid="scrubber"
          />
        </label>
        <output className="preview__time" aria-label="Tiempo">
          {time.toFixed(1)} / {duration.toFixed(1)} s
        </output>
      </div>
      {reduced && <p className="muted">Reproducción automática desactivada por tu preferencia de movimiento reducido. Pulsa «Reproducir» cuando quieras.</p>}
    </div>
  );
}
