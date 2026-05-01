import { useDashboardStore } from '../state/store.js';

export function CameraPanel() {
  const cameras = useDashboardStore((s) => s.state.cameras);
  const events = Object.entries(cameras);
  return (
    <section>
      <h2>Cameras</h2>
      {events.map(([cameraId, event]) => (
        <article key={cameraId}>
          <strong>{cameraId}</strong>{event?.id ? ` · ${event.id}` : ''}
        </article>
      ))}
    </section>
  );
}
