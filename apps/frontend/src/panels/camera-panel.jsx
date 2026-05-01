import { useDashboardStore } from '../state/store.js';

export function CameraPanel() {
  const latestCameraEvents = useDashboardStore((s) => s.latestCameraEvents);
  const events = Object.values(latestCameraEvents);

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
