import { EventEmitter } from 'events';
import { createEvent, isDashboardEvent } from '../types/events.js';
import { throttle } from '../utils/throttle.js';

class DashboardEventBus {
  constructor({ throttleMs = 0, devLogging = false } = {}) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.devLogging = devLogging;
    this.dispatch = throttleMs > 0 ? throttle((event) => this.#dispatch(event), throttleMs) : (event) => this.#dispatch(event);
  }

  publish(eventLike) {
    const event = isDashboardEvent(eventLike) ? eventLike : createEvent(eventLike);
    if (this.devLogging) console.debug('[event-bus]', event.type, event.source, event.payload);
    this.dispatch(event);
    return event;
  }

  subscribe(type, handler) {
    const wrapped = (event) => handler(event);
    this.emitter.on(type, wrapped);
    return () => this.emitter.off(type, wrapped);
  }

  #dispatch(event) {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }
}

export const eventBus = new DashboardEventBus({
  throttleMs: Number(process.env.EVENT_BUS_THROTTLE_MS || 0),
  devLogging: process.env.NODE_ENV !== 'production'
});
