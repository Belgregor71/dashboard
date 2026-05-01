export function validateEvent(event) {
  if (!event || typeof event !== 'object') {
    return { valid: false, error: 'Event must be an object' };
  }

  if (typeof event.type !== 'string' || event.type.length === 0) {
    return { valid: false, error: 'Event type must be a non-empty string' };
  }

  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return { valid: false, error: 'Event payload must be an object' };
  }

  if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp)) {
    return { valid: false, error: 'Event timestamp must be a finite number' };
  }

  return { valid: true };
}

export function createEvent({ type, payload = {}, timestamp = Date.now() }) {
  return { type, payload, timestamp };
}
