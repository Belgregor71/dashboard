import { WebSocketServer } from 'ws';
import { eventBus } from '../../../packages/event-bus/index.js';

export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const forwardEvent = (type) => (payload) => {
    const message = JSON.stringify({ type, payload });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(message);
    }
  };

  const unsubscribers = [
    eventBus.onEvent('camera.motionDetected', forwardEvent('camera.motionDetected')),
    eventBus.onEvent('camera.imageCaptured', forwardEvent('camera.imageCaptured')),
    eventBus.onEvent('calendar.updated', forwardEvent('calendar.updated')),
    eventBus.onEvent('media.statusChanged', forwardEvent('media.statusChanged'))
  ];

  wss.on('close', () => unsubscribers.forEach((unsubscribe) => unsubscribe()));

  return wss;
}
