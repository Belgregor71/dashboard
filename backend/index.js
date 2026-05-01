import 'dotenv/config';
import express from 'express';
import http from 'http';
import { CameraService } from './services/camera/index.js';
import { attachWebSocketGateway } from './ws/ws-gateway.js';
import { CalendarService } from './services/calendar/index.js';
import { HomeAssistantService } from './services/homeAssistant/index.js';
import { SystemService } from './services/system/index.js';
import { ServiceManager } from './core/service-manager.js';
import { eventBus } from '../packages/event-bus/index.js';
import { StateAggregator } from './core/state-aggregator.js';
import { appConfig } from '../packages/config/index.js';

const app = express();
const cameraService = new CameraService({ pollIntervalMs: appConfig.pollIntervalMs, eventBus });
const calendarService = new CalendarService({ eventBus });
const homeAssistantService = new HomeAssistantService();
const systemService = new SystemService({ eventBus });
const stateAggregator = new StateAggregator({ eventBus });

const serviceManager = new ServiceManager([
  { name: 'camera', instance: cameraService, restartDelayMs: 2000 },
  { name: 'calendar', instance: calendarService, restartDelayMs: 5000 },
  { name: 'home-assistant', instance: homeAssistantService, restartDelayMs: 5000 },
  { name: 'system', instance: systemService, restartDelayMs: 5000 }
]);

app.use(express.json({ limit: '256kb' }));
app.use(express.static('public'));
app.get('/api/health', (_req, res) => res.json(systemService.health()));
const server = http.createServer(app);
attachWebSocketGateway(server, { eventBus, stateAggregator, wsPath: appConfig.wsPath });

server.listen(appConfig.port, () => {
  console.log(`[backend] listening on :${appConfig.port}`);
  serviceManager.startAll();
});
