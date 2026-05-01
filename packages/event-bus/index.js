import { EventEmitter } from 'events';
import { createEvent, validateEvent } from '../types/events.js';

class DashboardEventBus {
  constructor({ devLogging = false } = {}) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.devLogging = devLogging;
  }

  emit(eventLike) {
    const event = createEvent(eventLike);
    const validation = validateEvent(event);

    if (!validation.valid) {
      console.error('[event-bus] Rejected invalid event:', validation.error, eventLike);
      return null;
    }

    if (this.devLogging) {
      console.debug('[event-bus] Event emitted:', event.type, event.payload);
    }

    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
    return event;
  }

  subscribe(type, handler) {
    const wrapped = (event) => handler(event);
    this.emitter.on(type, wrapped);
    return () => this.emitter.off(type, wrapped);
  }
}

let singletonEventBus;

export function getEventBus() {
  if (!singletonEventBus) {
    singletonEventBus = new DashboardEventBus({
      devLogging: process.env.NODE_ENV !== 'production'
    });
  }

  return singletonEventBus;
}

export const eventBus = getEventBus();
