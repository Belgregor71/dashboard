export function connectWebSocket({ onEvent }) {
  let ws;
  let retryMs = 1000;
  let heartbeatTimer;

  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

    ws.onopen = () => {
      retryMs = 1000;
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' }));
      }, 10000);
    };

    ws.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data));
      } catch {
        // ignore invalid payload
      }
    };

    ws.onclose = () => {
      clearInterval(heartbeatTimer);
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    };
  };

  connect();
  return { close: () => ws?.close() };
}
