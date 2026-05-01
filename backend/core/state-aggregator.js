export class StateAggregator {
  constructor({ eventBus }) {
    this.eventBus = eventBus;
    this.state = { cameras: {}, weather: {}, system: {}, calendar: {} };
    this.unsub = this.eventBus.subscribe('*', (event) => this.applyEvent(event));
  }

  getState() {
    return structuredClone(this.state);
  }

  applyEvent(event) {
    switch (event.type) {
      case 'CAMERA_MOTION_DETECTED':
      case 'CAMERA_IMAGE_CAPTURED': {
        const { cameraId, ...rest } = event.payload;
        if (!cameraId) return;
        this.state.cameras[cameraId] = { ...(this.state.cameras[cameraId] || {}), ...rest };
        break;
      }
      case 'CALENDAR_UPDATED':
        this.state.calendar = { ...this.state.calendar, ...event.payload };
        break;
      case 'SYSTEM_HEALTH':
        this.state.system = { ...event.payload };
        break;
      default:
        break;
    }

    console.debug('[state-aggregator] Event applied:', event.type);
  }
}
