import { WebSocketServer } from 'ws';
import { eventBus } from '../core/event-bus.js';

export function attachWebSocketGateway(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const eventTypes = ['camera.motionDetected', 'camera.imageCaptured', 'calendar.updated', 'system.status'];

  const unsubscribers = eventTypes.map((type) => eventBus.onEvent(type, (payload) => {
    const message = JSON.stringify({ type, payload });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(message);
    }
  }));

  wss.on('close', () => unsubscribers.forEach((unsubscribe) => unsubscribe()));
  return wss;
}
