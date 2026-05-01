import { useEffect } from 'preact/hooks';
import { useDashboardStore } from '../state/store.js';

export function CameraPanel() {
  const latestCameraEvents = useDashboardStore((s) => s.latestCameraEvents);
  const clearStaleCameraImages = useDashboardStore((s) => s.clearStaleCameraImages);
  const events = Object.values(latestCameraEvents);

  useEffect(() => {
    const timer = setInterval(() => clearStaleCameraImages(), 5000);
    return () => clearInterval(timer);
  }, [clearStaleCameraImages]);

  return (
    <section>
      <h2>Cameras</h2>
      {events.map((event) => (
        <article key={event.id}>
          <strong>{event.cameraId}</strong> · {new Date(event.timestamp).toLocaleTimeString()}
        </article>
      ))}
    </section>
  );
}
