import 'dotenv/config';
import express from 'express';
import http from 'http';
import { CameraService } from '../services/camera/camera.service.js';
import { attachWebSocketGateway } from './ws/ws-gateway.js';
import { CalendarService } from './services/calendar/index.js';
import { HomeAssistantService } from './services/homeAssistant/index.js';
import { SystemService } from './services/system/index.js';

const app = express();
const port = Number(process.env.PORT || 3000);

const cameraService = new CameraService({ pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 30000) });
const calendarService = new CalendarService();
const homeAssistantService = new HomeAssistantService();
const systemService = new SystemService();

app.use(express.json({ limit: '256kb' }));

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
  cameraService.start();
});
