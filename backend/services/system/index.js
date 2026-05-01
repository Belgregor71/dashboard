export class SystemService {
  constructor({ eventBus }) { this.eventBus = eventBus; }
  health() {
    const payload = { ok: true, timestamp: Date.now() };
    this.eventBus.emit({ type: 'SYSTEM_HEALTH', payload });
    return payload;
  }
}
