import { hrefFor } from '../../app/route.ts';
import { VideoDetail } from './VideoDetail.tsx';
import type { VideoRecord } from './model.ts';
import { useVideos } from './store.ts';
import { VideosView } from './VideosView.tsx';

interface Props {
  /** `null` = lista; si no, la ficha de ese vídeo. */
  readonly videoId: string | null;
  readonly onOpenStudio: (record: VideoRecord) => void;
}

/** Sección «Vídeos»: lista o ficha según la ruta. */
export function VideosSection({ videoId, onOpenStudio }: Props) {
  const videos = useVideos();
  if (videoId === null) return <VideosView />;
  const record = videos.find((v) => v.id === videoId);
  if (record === undefined) {
    return (
      <div className="empty" data-testid="video-missing">
        <h1>No existe esa ficha</h1>
        <p className="muted">Puede que la hayas eliminado o que se guardara en otro navegador.</p>
        <a className="btn btn--primary" href={hrefFor({ view: 'videos', videoId: null })}>
          Volver a Vídeos
        </a>
      </div>
    );
  }
  return <VideoDetail key={record.id} record={record} onOpenStudio={onOpenStudio} />;
}
