export class SystemService {
  constructor({ eventBus }) { this.eventBus = eventBus; }
  health() {
    const payload = { ok: true, timestamp: Date.now() };
    this.eventBus.publish({ type: 'SYSTEM_HEALTH', source: 'system-service', payload });
    return payload;
  }
}
