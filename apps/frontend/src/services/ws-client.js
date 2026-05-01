export function connectWebSocket({ onEvent }) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data));
    } catch {
      // ignore invalid payload
    }
  };
  return ws;
}
