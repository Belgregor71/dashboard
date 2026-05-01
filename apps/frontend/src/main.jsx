import { render } from 'preact';
import { Suspense } from 'preact/compat';
import { GridLayout } from './components/layout.jsx';
import { useDashboardStore } from './state/store.js';
import { connectWebSocket } from './services/ws-client.js';
import { panelRegistry } from './panel-registry.js';

const activePanels = ['camera'];

function App() {
  return (
    <GridLayout>
      <Suspense fallback={<div>Loading panels…</div>}>
        {activePanels.map((panelKey) => {
          const Panel = panelRegistry[panelKey];
          return Panel ? <Panel key={panelKey} /> : null;
        })}
      </Suspense>
    </GridLayout>
  );
}

const { setLatestCameraEvent, clearStaleCameraImages } = useDashboardStore.getState();
connectWebSocket({
  onEvent: ({ type, payload }) => {
    if (type === 'camera.motionDetected' || type === 'camera.imageCaptured') {
      setLatestCameraEvent(payload);
      clearStaleCameraImages();
    }
  }
});

render(<App />, document.getElementById('app'));
