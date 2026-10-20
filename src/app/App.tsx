import { Info, Trophy } from 'lucide-react';

export function App() {
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
        <h1 className="visually-hidden">futbol-sim</h1>
        <p className="notice">
          <Info aria-hidden="true" size={20} />
          <span>
            Base del proyecto lista. El calendario real, el motor de simulación y la exportación a MP4 se
            incorporan en las siguientes fases.
          </span>
        </p>
      </main>
    </div>
  );
}
