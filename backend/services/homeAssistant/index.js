import fetch from 'node-fetch';

async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class HomeAssistantService {
  async getSnapshot() {
    const haHost = process.env.HA_HOST;
    const token = process.env.HA_TOKEN;
    if (!haHost || !token) return { home_mode: null, alerts: [], connectivity: [], devices: [] };

    const url = `${haHost.replace(/\/$/, '')}/api/states`;
    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });

    if (!response.ok) throw new Error(`HA fetch failed (${response.status})`);
    const raw = await response.json();
    const unavailableCount = raw.filter((item) => item?.state === 'unavailable').length;
    return {
      home_mode: null,
      alerts: unavailableCount ? [{ id: 'ha-unavailable', severity: 'warning', title: `${unavailableCount} entities unavailable` }] : [],
      connectivity: [{ id: 'ha-core', label: 'Home Assistant', state: 'ok', detail: 'Connected' }],
      devices: []
    };
  }
}
