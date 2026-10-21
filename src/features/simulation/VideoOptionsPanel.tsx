import { RotateCcw } from 'lucide-react';

import { BOUNCE_LEVELS } from './bounce.ts';
import {
  DEFAULT_VIDEO_OPTIONS,
  MAX_GOAL_TEXT,
  MAX_HOOK,
  MAX_WATERMARK,
  THEMES,
  THEME_IDS,
  type VideoOptions,
} from './options.ts';
import type { VideoStyle } from './renderers.ts';

interface Props {
  readonly options: VideoOptions;
  readonly style: VideoStyle;
  readonly onChange: (patch: Partial<VideoOptions>) => void;
  readonly onReset: () => void;
}

/** Personalización del vídeo: colores, rebotes, qué se muestra y textos propios. Se guarda en el navegador y vale para la vista previa, la exportación y los lotes. */
export function VideoOptionsPanel({ options, style, onChange, onReset }: Props) {
  const arena = style === 'arena';
  const changed = JSON.stringify(options) !== JSON.stringify(DEFAULT_VIDEO_OPTIONS);
  return (
    <div className="card" aria-label="Personalizar el vídeo" data-testid="options-panel">
      <h2>Personalizar el vídeo</h2>
      <p className="muted">Lo que elijas se guarda en tu navegador y se aplica a la vista previa, a la exportación y a los lotes.</p>

      {arena && (
        <>
          <div className="options__group" role="group" aria-label="Colores de la arena">
            <span className="options__label">Colores de la arena</span>
            <div className="swatches">
              {THEME_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="swatch"
                  aria-pressed={options.theme === id}
                  onClick={() => { onChange({ theme: id }); }}
                  data-testid={`theme-${id}`}
                >
                  <span className="swatch__dot" style={{ background: THEMES[id].swatch }} aria-hidden="true" />
                  {THEMES[id].label}
                </button>
              ))}
            </div>
          </div>

          <div className="options__group" role="group" aria-label="Rebotes del balón">
            <span className="options__label">Rebotes del balón en las paredes</span>
            <div className="segmented">
              {BOUNCE_LEVELS.map((b) => (
                <button key={b.value} type="button" aria-pressed={options.bounce === b.value} onClick={() => { onChange({ bounce: b.value }); }} data-testid={`bounce-${b.value}`}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <fieldset className="options__checks">
        <legend>Qué se muestra</legend>
        <label className="check">
          <input type="checkbox" checked={options.showStats} onChange={(e) => { onChange({ showStats: e.target.checked }); }} data-testid="opt-stats" />
          <span>Estadísticas (tiros y a puerta)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={options.showTicker} onChange={(e) => { onChange({ showTicker: e.target.checked }); }} data-testid="opt-ticker" />
          <span>Último suceso (rótulo inferior)</span>
        </label>
        {arena && (
          <label className="check">
            <input type="checkbox" checked={options.ballTrail} onChange={(e) => { onChange({ ballTrail: e.target.checked }); }} data-testid="opt-trail" />
            <span>Estela del balón</span>
          </label>
        )}
      </fieldset>

      <label className="field">
        <span>Texto gancho bajo la competición</span>
        <input
          value={options.hook}
          maxLength={MAX_HOOK}
          placeholder="¿Quién gana? Comenta tu marcador"
          onChange={(e) => { onChange({ hook: e.target.value }); }}
          data-testid="opt-hook"
        />
      </label>
      <label className="field">
        <span>Marca de agua al pie (tu usuario)</span>
        <input
          value={options.watermark}
          maxLength={MAX_WATERMARK}
          placeholder="@tu_cuenta"
          onChange={(e) => { onChange({ watermark: e.target.value }); }}
          data-testid="opt-watermark"
        />
      </label>
      <label className="field">
        <span>Texto del gol</span>
        <input
          value={options.goalText}
          maxLength={MAX_GOAL_TEXT}
          placeholder="¡GOL!"
          onChange={(e) => { onChange({ goalText: e.target.value }); }}
          data-testid="opt-goal"
        />
      </label>

      <button type="button" className="btn" onClick={onReset} disabled={!changed} data-testid="opt-reset">
        <RotateCcw aria-hidden="true" size={18} />
        Restaurar valores
      </button>
    </div>
  );
}
