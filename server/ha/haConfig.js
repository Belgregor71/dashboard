function normalizeBaseUrl(url) {
  if (!url || typeof url !== "string") return "";
  return url.trim().replace(/\/$/, "");
}

export function readHaConfig({ requireConfig = true } = {}) {
  const haHost = normalizeBaseUrl(process.env.HA_HOST || process.env.HA_URL);
  const haToken = (process.env.HA_TOKEN || "").trim();

  const missing = [];
  if (!haHost) missing.push("HA_HOST");
  if (!haToken) missing.push("HA_TOKEN");

  // Misconfigured now reads exactly like HA_ENABLED=0: the integration is off
  // and /api/ha/* answers 503, but weather, calendar, photos, recipes and the
  // clock still boot. It used to be process.exit(1) at startup, so one bad env
  // line darked the whole kiosk (audit 2026-07-26, M1).
  const enabled = process.env.HA_ENABLED === "0" ? false : missing.length === 0;

  // Only haRest and haWs ask for the credentials, and neither is reachable
  // while disabled — so this is an assertion, not a boot gate. Every caller
  // already handles the rejection.
  if (requireConfig && missing.length) {
    throw new Error(`Home Assistant integration misconfigured: missing ${missing.join(", ")}`);
  }

  return { haHost, haToken, enabled, missing };
}
