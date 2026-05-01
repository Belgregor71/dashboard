import { render } from 'preact';
import { Suspense } from 'preact/compat';
import { GridLayout } from './components/layout.jsx';
import { useDashboardStore } from './state/store.js';
import { connectWebSocket } from './services/ws-client.js';
import { panelRegistry } from './panel-registry.js';

const activePanels = ['camera'];
function App() { return <GridLayout><Suspense fallback={<div>Loading panels…</div>}>{activePanels.map((k) => { const P = panelRegistry[k]; return P ? <P key={k} /> : null; })}</Suspense></GridLayout>; }
const { handleEvent } = useDashboardStore.getState();
connectWebSocket({ onEvent: handleEvent });
render(<App />, document.getElementById('app'));
