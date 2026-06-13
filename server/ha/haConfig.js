function normalizeBaseUrl(url) {
  if (!url || typeof url !== "string") return "";
  return url.trim().replace(/\/$/, "");
}

export function readHaConfig({ requireConfig = true } = {}) {
  const haHost = normalizeBaseUrl(process.env.HA_HOST || process.env.HA_URL);
  const haToken = (process.env.HA_TOKEN || "").trim();
  const enabled = process.env.HA_ENABLED === "0" ? false : true;

  if (requireConfig && enabled) {
    const missing = [];
    if (!haHost) missing.push("HA_HOST");
    if (!haToken) missing.push("HA_TOKEN");
    if (missing.length) {
      throw new Error(`Home Assistant integration misconfigured: missing ${missing.join(", ")}`);
    }
  }

  return { haHost, haToken, enabled };
}
