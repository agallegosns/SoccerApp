import { Trophy } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';

import { createServices } from '../data/registry.ts';
import type { Match } from '../data/types.ts';
import { CalendarView } from '../features/calendar/CalendarView.tsx';
import { UpdateNotice } from './UpdateNotice.tsx';

// El estudio (motor, render, exportador y mediabunny) pesa mucho más que el calendario: se carga sólo al abrirlo.
const SimulationStudio = lazy(() => import('../features/simulation/SimulationStudio.tsx').then((m) => ({ default: m.SimulationStudio })));

export function App() {
  const [services] = useState(createServices);
  const [selected, setSelected] = useState<Match | null>(null);
  const [studioMatch, setStudioMatch] = useState<Match | null>(null);

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-inner">
          <div className="app__brand">
            <Trophy aria-hidden="true" size={24} />
            <span>futbol-sim</span>
          </div>
          <span className="badge">Simulación ficticia</span>
        </div>
      </header>
      <main className="app__main">
        <UpdateNotice />
        {studioMatch === null ? (
          <CalendarView service={services.service} imported={services.imported} selected={selected} onSelect={setSelected} onSimulate={setStudioMatch} />
        ) : (
          <Suspense
            fallback={
              <p className="muted" role="status">
                Cargando el estudio de simulación…
              </p>
            }
          >
            <SimulationStudio
              match={studioMatch}
              onBack={() => {
                setStudioMatch(null);
              }}
            />
          </Suspense>
        )}
      </main>
    </div>
  );
}
