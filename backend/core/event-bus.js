import { EventEmitter } from 'events';

class BackendEventBus extends EventEmitter {
  emitEvent(type, payload = {}) {
    this.emit(type, payload);
  }

  onEvent(type, listener) {
    this.on(type, listener);
    return () => this.off(type, listener);
  }
}

export const eventBus = new BackendEventBus();
