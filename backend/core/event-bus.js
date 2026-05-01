import { EventEmitter } from 'events';
import { throttle } from '../../packages/utils/throttle.js';

class BackendEventBus extends EventEmitter {
  constructor() {
    super();
    this.emitThrottled = throttle((event) => {
      this.emit(event.type, event);
      this.emit('*', event);
    }, 100);
  }

  emitEvent(type, payload = {}, source = 'backend') {
    const event = {
      type,
      payload,
      timestamp: new Date().toISOString(),
      source
    };

    this.emitThrottled(event);
    return event;
  }

  onEvent(type, listener) {
    this.on(type, listener);
    return () => this.off(type, listener);
  }
}

export const eventBus = new BackendEventBus();
