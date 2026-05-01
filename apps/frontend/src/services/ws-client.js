import { appConfig } from '../../../../packages/config/index.js';

export function connectWebSocket({ store }) {
  let ws;
  let retryMs = 1000;
  let closed = false;

  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${appConfig.wsPath}`);

    ws.onopen = () => {
      retryMs = 1000;
      console.debug('[ws-client] connected');
    };

    ws.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data);
        if (data.type === 'STATE_SNAPSHOT') store.applySnapshot(data.payload);
        if (data.type === 'STATE_EVENT') store.applyEvent(data.payload);
      } catch (error) {
        console.error('[ws-client] invalid message', error);
      }
    };

    ws.onclose = () => {
      console.debug('[ws-client] disconnected');
      if (closed) return;
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    };

    ws.onerror = (error) => {
      console.error('[ws-client] websocket error', error);
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      ws?.close();
    }
  };
}
