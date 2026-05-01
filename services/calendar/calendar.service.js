import { eventBus } from '../../packages/event-bus/index.js';

export class CalendarService {
  async refresh() {
    // Replace with real iCal provider calls.
    eventBus.emitEvent('calendar.updated', {
      timestamp: new Date().toISOString(),
      events: []
    });
  }
}
