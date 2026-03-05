export function parseEntityNumber(entity, fallback = 0) {
  if (!entity) return fallback;
  const raw = typeof entity === "object" ? entity.state : entity;
  if (raw == null) return fallback;
  const value = Number.parseFloat(String(raw).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(value) ? value : fallback;
}

export function formatSpeed(bytesPerSecond = 0) {
  const value = Math.max(0, Number(bytesPerSecond) || 0);
  if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(2)}GB/s`;
  if (value >= 1024 ** 2) return `${(value / (1024 ** 2)).toFixed(1)}MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KB/s`;
  return `${Math.round(value)}B/s`;
}

export function formatDataSize(bytes = 0) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 ** 4) return `${(value / (1024 ** 4)).toFixed(2)} TB`;
  if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / (1024 ** 2)).toFixed(1)} MB`;
  return `${Math.round(value)} B`;
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) return "";
  const deltaSeconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  return `${deltaSeconds}s ago`;
}

export function parseDiskAttributes(entity) {
  const attrs = entity?.attributes || {};
  const free = Number(attrs.free_space ?? attrs.free ?? 0);
  const total = Number(attrs.total_space ?? attrs.total ?? 0);
  const used = Number(attrs.used_space ?? attrs.used ?? Math.max(0, total - free));
  const validTotal = Number.isFinite(total) && total > 0 ? total : null;
  const validFree = Number.isFinite(free) ? free : 0;
  const freePct = validTotal ? (validFree / validTotal) * 100 : null;
  return {
    free: validFree,
    total: validTotal,
    used: Number.isFinite(used) ? used : 0,
    freePct
  };
}

export function createCooldownController(cooldownMs = 90_000) {
  let lastActiveAt = 0;
  return {
    markActive() {
      lastActiveAt = Date.now();
    },
    shouldShow(isActive) {
      if (isActive) {
        lastActiveAt = Date.now();
        return true;
      }
      return Date.now() - lastActiveAt < cooldownMs;
    }
  };
}

export function setTextIfChanged(el, nextValue) {
  if (!el) return;
  const value = `${nextValue ?? ""}`;
  if (el.textContent !== value) {
    el.textContent = value;
  }
}
