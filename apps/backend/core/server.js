import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { appConfig } from '../../../packages/config/index.js';
import { createHealthRoutes } from '../routes/health.routes.js';
import { createCameraRoutes } from '../routes/camera.routes.js';
import { createServiceRegistry } from './service-registry.js';
import { attachWebSocketServer } from '../ws/ws-gateway.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer() {
  const app = express();
  const serviceRegistry = createServiceRegistry();

  app.use(express.json({ limit: '128kb' }));
  app.use('/api', createHealthRoutes());
  app.use('/api', createCameraRoutes(serviceRegistry));
  app.use('/public', express.static(path.join(__dirname, '../../../public')));

  const httpServer = http.createServer(app);
  attachWebSocketServer(httpServer);

  return { app, httpServer, serviceRegistry };
}

export function startServer() {
  const { httpServer, serviceRegistry } = createServer();
  httpServer.listen(appConfig.port, () => {
    console.log(`[backend] listening on :${appConfig.port}`);
    serviceRegistry.camera.start();
  });
}
