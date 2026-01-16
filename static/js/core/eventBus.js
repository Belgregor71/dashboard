const listeners = {};

export function on(event, handler) {
  if (!listeners[event]) {
    listeners[event] = [];
  }
  listeners[event].push(handler);
}

export function emit(event, payload = {}) {
  if (!listeners[event]) return;
  listeners[event].forEach(handler => handler(payload));
}
