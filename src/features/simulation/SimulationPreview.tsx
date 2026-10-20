import { Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { Simulation } from '../../engine/index.ts';
import type { RenderMeta } from './render.ts';
import { drawVideoFrame, type VideoStyle } from './renderers.ts';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from './theme.ts';

interface Props {
  readonly sim: Simulation;
  readonly meta: RenderMeta;
  readonly label: string;
  readonly style: VideoStyle;
  /** Posición solicitada desde fuera (p. ej. al pulsar un suceso). `nonce` fuerza el salto aunque el valor se repita. */
  readonly seek: { readonly t: number; readonly nonce: number } | null;
}

const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Vista previa en canvas 1080×1920 con reproducción, pausa y barra de posición. Remontar (key) al cambiar de simulación. */
export function SimulationPreview({ sim, meta, label, style, seek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [time, setTime] = useState(0);
  const [reduced] = useState(prefersReducedMotion);
  const [wantsPlay, setWantsPlay] = useState(!reduced);
  const [seenNonce, setSeenNonce] = useState(seek?.nonce ?? 0);
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

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx === null || ctx === undefined) return;
    drawVideoFrame(ctx, sim, time, meta, style);
  }, [sim, time, meta, style]);

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
