import { WebSocketServer } from 'ws';

export function attachWebSocketGateway(httpServer, { eventBus, stateAggregator, wsPath = '/ws' }) {
  const wss = new WebSocketServer({ server: httpServer, path: wsPath });

  wss.on('connection', (ws, req) => {
    console.log('[ws] client connected:', req.socket.remoteAddress);

    ws.send(
      JSON.stringify({
        type: 'STATE_SNAPSHOT',
        payload: stateAggregator.getState()
      })
    );
    console.debug('[ws] message sent: STATE_SNAPSHOT');

    const unsubscribe = eventBus.subscribe('*', (event) => {
      if (ws.readyState !== 1) return;
      ws.send(
        JSON.stringify({
          type: 'STATE_EVENT',
          payload: event
        })
      );
      console.debug('[ws] message sent: STATE_EVENT', event.type);
    });

    ws.on('close', () => {
      unsubscribe();
      console.log('[ws] client disconnected:', req.socket.remoteAddress);
    });

    ws.on('error', (error) => {
      console.error('[ws] client error:', error.message);
    });
  });
}
