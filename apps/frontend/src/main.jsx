import { render } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { GridLayout } from './components/layout.jsx';
import { useDashboardStore } from './state/store.js';
import { connectWebSocket } from './services/ws-client.js';

const CameraPanel = lazy(() => import('./panels/camera-panel.jsx').then((m) => ({ default: m.CameraPanel })));

function App() {
  return (
    <GridLayout>
      <Suspense fallback={<div>Loading panels…</div>}>
        <CameraPanel />
      </Suspense>
    </GridLayout>
  );
}

const setLatestCameraEvent = useDashboardStore.getState().setLatestCameraEvent;
connectWebSocket({
  onEvent: ({ type, payload }) => {
    if (type === 'camera.motionDetected' || type === 'camera.imageCaptured') {
      setLatestCameraEvent(payload);
    }
  }
});

render(<App />, document.getElementById('app'));
