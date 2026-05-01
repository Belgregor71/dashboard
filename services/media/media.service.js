import { eventBus } from '../../packages/event-bus/index.js';

export class MediaService {
  async refresh() {
    eventBus.emitEvent('media.statusChanged', {
      timestamp: new Date().toISOString(),
      playing: false
    });
  }
}
