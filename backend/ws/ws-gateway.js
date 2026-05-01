import { WebSocketServer } from 'ws';

export function attachWebSocketGateway(httpServer, { eventBus, stateAggregator, wsPath = '/ws' }) {
  const wss = new WebSocketServer({ server: httpServer, path: wsPath });
  const queue = [];
  let rafPending = false;

  const flush = () => {
    rafPending = false;
    const messages = queue.splice(0, queue.length);
    if (!messages.length) return;
    for (const client of wss.clients) {
      if (client.readyState !== 1) continue;
      for (const m of messages) client.send(JSON.stringify(m));
    }
  };

  const scheduleFlush = () => {
    if (rafPending) return;
    rafPending = true;
    setTimeout(flush, 16);
  };

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.send(JSON.stringify({ type: 'INIT_STATE', payload: stateAggregator.getState() }));
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.isAlive) client.terminate();
      client.isAlive = false;
      client.ping();
    }
  }, 15000);

  const unsubscribe = eventBus.subscribe('STATE_UPDATED', (event) => {
    queue.push({ type: 'STATE_UPDATE', payload: event.payload });
    scheduleFlush();
  });

  wss.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
