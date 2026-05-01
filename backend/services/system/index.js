export class SystemService {
  health() {
    return { ok: true, timestamp: new Date().toISOString() };
  }
}
