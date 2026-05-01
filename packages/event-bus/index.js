import { EventEmitter } from 'events';

/**
 * Lightweight singleton event bus.
 * Kept tiny for Raspberry Pi memory constraints.
 */
class DashboardEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(40);
  }

  emitEvent(type, payload) {
    this.emit(type, payload);
  }

  onEvent(type, handler) {
    this.on(type, handler);
    return () => this.off(type, handler);
  }
}

export const eventBus = new DashboardEventBus();
