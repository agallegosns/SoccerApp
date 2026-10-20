import { Trophy } from 'lucide-react';
import { useState } from 'react';

import { createServices } from '../data/registry.ts';
import type { Match } from '../data/types.ts';
import { CalendarView } from '../features/calendar/CalendarView.tsx';

export function App() {
  const [services] = useState(createServices);
  const [selected, setSelected] = useState<Match | null>(null);

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
        <CalendarView service={services.service} imported={services.imported} selected={selected} onSelect={setSelected} />
      </main>
    </div>
  );
}
