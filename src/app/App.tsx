import { Trophy } from 'lucide-react';
import { Suspense, lazy, useEffect, useState } from 'react';

import { createServices } from '../data/registry.ts';
import type { Match } from '../data/types.ts';
import { CalendarView } from '../features/calendar/CalendarView.tsx';
import { startAutoSync } from '../features/stats/sync.ts';
import { useVideos } from '../features/videos/store.ts';
import type { VideoRecord } from '../features/videos/model.ts';
import type { StudioInitial } from '../features/simulation/SimulationStudio.tsx';
import { AppNav } from './AppNav.tsx';
import { navigate, useRoute } from './route.ts';
import { UpdateNotice } from './UpdateNotice.tsx';
import { DuePrompt } from '../features/videos/DuePrompt.tsx';
import { startDeviceSync } from '../features/sync/deviceSync.ts';
import { SyncButton } from '../features/sync/SyncDialog.tsx';

// El estudio (motor, render, exportador y mediabunny) pesa mucho más que el calendario: se carga sólo al abrirlo.
const SimulationStudio = lazy(() => import('../features/simulation/SimulationStudio.tsx').then((m) => ({ default: m.SimulationStudio })));
const VideosSection = lazy(() => import('../features/videos/VideosSection.tsx').then((m) => ({ default: m.VideosSection })));
const StatsView = lazy(() => import('../features/stats/StatsView.tsx').then((m) => ({ default: m.StatsView })));

interface StudioState {
  readonly match: Match;
  readonly initial?: StudioInitial;
  /** Hash de la sección en la que se abrió: el estudio sólo se muestra mientras se siga en ella. */
  readonly hash: string;
  /** Adónde vuelve el botón «Volver». */
  readonly back: 'calendar' | 'video';
  readonly videoId?: string;
}

const Loading = ({ what }: { readonly what: string }) => (
  <p className="muted" role="status">
    Cargando {what}…
  </p>
);

export function App() {
  const [services] = useState(createServices);

  // Estadísticas automáticas: si hay un Worker conectado, se leen al abrir la app y cada 30 minutos (no hace nada si no hay conexión configurada).
  useEffect(() => startAutoSync(), []);
  // Sincronización móvil ⇄ ordenador (opcional): sólo actúa si el usuario conectó su Worker.
  useEffect(() => startDeviceSync(), []);
  const [selected, setSelected] = useState<Match | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const route = useRoute();
  const videos = useVideos();
  const hash = window.location.hash;
  const studioVisible = studio !== null && studio.hash === hash;

  function openStudio(match: Match): void {
    setStudio({ match, hash, back: 'calendar' });
  }

  function openStudioFromVideo(record: VideoRecord): void {
    setStudio({
      match: record.match,
      initial: { seed: record.seed, fixedScore: record.fixedScore, style: record.style, pace: record.pace, options: record.options },
      hash: '#/',
      back: 'video',
      videoId: record.id,
    });
    navigate({ view: 'calendar' });
  }

  function closeStudio(): void {
    const s = studio;
    setStudio(null);
    if (s?.back === 'video' && s.videoId !== undefined) navigate({ view: 'videos', videoId: s.videoId });
  }

  return (
    <div className="app app--with-nav">
      <header className="app__header">
        <div className="app__header-inner">
          <div className="app__brand">
            <Trophy aria-hidden="true" size={24} />
            <span>futbol-sim</span>
          </div>
          <span className="badge">Simulación ficticia</span>
          <AppNav route={route} videoCount={videos.length} onNavigate={() => { setStudio(null); }} />
          <SyncButton />
        </div>
      </header>
      <main className="app__main">
        <UpdateNotice />
        <DuePrompt />
        {studioVisible ? (
          <Suspense fallback={<Loading what="el estudio de simulación" />}>
            <SimulationStudio match={studio.match} initial={studio.initial} backLabel={studio.back === 'video' ? 'Volver a la ficha del vídeo' : 'Volver al calendario'} onBack={closeStudio} />
          </Suspense>
        ) : route.view === 'calendar' ? (
          <CalendarView service={services.service} imported={services.imported} selected={selected} onSelect={setSelected} onSimulate={openStudio} />
        ) : route.view === 'videos' ? (
          <Suspense fallback={<Loading what="los vídeos" />}>
            <VideosSection videoId={route.videoId} onOpenStudio={openStudioFromVideo} />
          </Suspense>
        ) : (
          <Suspense fallback={<Loading what="las estadísticas" />}>
            <StatsView onOpenVideo={(id) => { navigate({ view: 'videos', videoId: id }); }} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
