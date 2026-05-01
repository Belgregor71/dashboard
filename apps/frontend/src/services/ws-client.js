import { appConfig } from '../../../../packages/config/index.js';

export function connectWebSocket({ onEvent }) {
  let ws; let retryMs = 1000; let heartbeat; const queue = []; let closed = false;
  const flushQueue = () => { while (queue.length) onEvent(queue.shift()); };
  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${appConfig.wsPath}`);
    ws.onopen = () => { retryMs = 1000; flushQueue(); heartbeat = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'PING' })), 10000); };
    ws.onmessage = (message) => { try { queue.push(JSON.parse(message.data)); requestAnimationFrame(flushQueue); } catch {} };
    ws.onclose = () => { clearInterval(heartbeat); if (closed) return; setTimeout(connect, retryMs); retryMs = Math.min(retryMs * 2, 15000); };
  };
  connect();
  return { close: () => { closed = true; ws?.close(); } };
}
