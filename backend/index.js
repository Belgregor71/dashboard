import 'dotenv/config';
import express from 'express';
import http from 'http';
import { CameraService } from './services/camera/index.js';
import { attachWebSocketGateway } from './ws/ws-gateway.js';
import { CalendarService } from './services/calendar/index.js';
import { HomeAssistantService } from './services/homeAssistant/index.js';
import { SystemService } from './services/system/index.js';
import { ServiceManager } from './core/service-manager.js';

const app = express();
const port = Number(process.env.PORT || 3000);

const cameraService = new CameraService({ pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 30000) });
const calendarService = new CalendarService();
const homeAssistantService = new HomeAssistantService();
const systemService = new SystemService();

const serviceManager = new ServiceManager([
  { name: 'camera', instance: cameraService, restartDelayMs: 2000 },
  { name: 'calendar', instance: calendarService, restartDelayMs: 5000 },
  { name: 'home-assistant', instance: homeAssistantService, restartDelayMs: 5000 },
  { name: 'system', instance: systemService, restartDelayMs: 5000 }
]);

app.use(express.json({ limit: '256kb' }));
app.use(express.static('public'));

app.get('/api/health', (_req, res) => res.json(systemService.health()));
app.post('/api/camera/poll', async (_req, res) => {
  await cameraService.poll();
  res.json({ ok: true });
});
app.get('/api/calendar/all', async (_req, res) => {
  const events = await calendarService.getMergedEvents();
  res.json(events);
});
app.get('/api/ha/snapshot', async (_req, res) => {
  const snapshot = await homeAssistantService.getSnapshot();
  res.json(snapshot);
});

const server = http.createServer(app);
attachWebSocketGateway(server);

server.listen(port, () => {
  console.log(`[backend] listening on :${port}`);
  serviceManager.startAll();
});
