import { WebSocketServer } from 'ws';
import { eventBus } from '../core/event-bus.js';

export function attachWebSocketGateway(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 15000);

  const unsubscribeAll = eventBus.onEvent('*', (event) => {
    const message = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(message);
    }
  });

  wss.on('close', () => {
    clearInterval(heartbeat);
    unsubscribeAll();
  });

  return wss;
}
