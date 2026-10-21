import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { ResolvedTeam } from '../../engine/index.ts';
import { drawCrest } from './crest.ts';
import { customCrest } from './crestStore.ts';
import type { TeamCrests } from './useTeamCrests.ts';
import { Collapsible } from '../../ui/Collapsible.tsx';

interface Props {
  readonly teams: readonly ResolvedTeam[];
  readonly crests: TeamCrests;
}

function CrestThumb({ team, version }: { readonly team: ResolvedTeam; readonly version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const custom = customCrest(team.name) !== null;
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx === null || ctx === undefined) return;
    ctx.clearRect(0, 0, 112, 112);
    drawCrest(ctx, team, 56, 56, 46);
  }, [team, version]);
  return <canvas ref={ref} width={112} height={112} className="crest-thumb" role="img" aria-label={`Escudo de ${team.name} (${custom ? 'subido por ti' : 'genérico'})`} />;
}

/** Escudo de cada equipo: genérico por defecto o la imagen que suba el usuario (se guarda sólo en su navegador). */
export function CrestsPanel({ teams, crests }: Props) {
  return (
    <Collapsible title="Escudos" hint="Sube el escudo de cada equipo" testId="crests-panel">
      <p className="muted">
        Por defecto se usa un escudo genérico con los colores del equipo. Puedes subir el escudo de cada equipo (PNG, JPG o WebP): aparecerá en la vista previa y en los
        vídeos. Se guarda sólo en tu navegador. Los escudos oficiales son marcas registradas: súbelos únicamente si tienes derecho a usarlos.
      </p>
      <ul className="plain-list crests">
        {teams.map((team) => {
          const custom = customCrest(team.name) !== null;
          const id = `crest-file-${team.side}`;
          return (
            <li key={team.side} className="crests__row">
              <CrestThumb team={team} version={crests.version} />
              <div className="crests__info">
                <strong>{team.name}</strong>
                <span className="muted">{custom ? 'Escudo subido por ti' : 'Escudo genérico'}</span>
              </div>
              <div className="row">
                <label className="btn btn--small" htmlFor={id}>
                  <ImagePlus aria-hidden="true" size={16} />
                  {crests.busy === team.name ? 'Procesando…' : custom ? 'Cambiar' : 'Subir escudo'}
                </label>
                <input
                  id={id}
                  className="visually-hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  data-testid={`crest-file-${team.side}`}
                  aria-label={`Subir escudo de ${team.name}`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file !== undefined) void crests.upload(team.name, file);
                  }}
                />
                {custom && (
                  <button type="button" className="btn btn--small" onClick={() => { crests.remove(team.name); }} data-testid={`crest-remove-${team.side}`}>
                    <Trash2 aria-hidden="true" size={16} />
                    Quitar
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {crests.error !== null && (
        <p className="alert alert--error" role="alert" data-testid="crest-error">
          {crests.error}
        </p>
      )}
    </Collapsible>
  );
}
