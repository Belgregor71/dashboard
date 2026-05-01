export function createEvent({ type, source, payload = {}, timestamp = Date.now() }) {
  if (!type || !source) throw new Error('Event requires type and source');
  return { type, source, timestamp, payload };
}

export function isDashboardEvent(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.type === 'string' &&
      typeof value.source === 'string' &&
      typeof value.timestamp === 'number' &&
      value.payload &&
      typeof value.payload === 'object'
  );
}
