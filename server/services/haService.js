import fetch from "node-fetch";
import { validateData } from "../middleware/validate.js";

/** @typedef {import("../types/api.js").HaSnapshotNormalized} HaSnapshotNormalized */

const REQUEST_TIMEOUT_MS = 6000;

function buildFallbackSnapshot() {
  return {
    home_mode: null,
    alerts: [{ id: "ha", severity: "critical", title: "Home Assistant data invalid", age_s: 0 }],
    connectivity: [],
    devices: []
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHaRaw({ haHost, token }) {
  const url = `${haHost.replace(/\/$/, "")}/api/states`;
  const response = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const error = new Error(`HA fetch failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/**
 * @param {any[]} raw
 * @returns {HaSnapshotNormalized}
 */
export function normalizeHaSnapshot(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const modeEntity = list.find((item) => item?.entity_id === "input_select.house_mode");
  const unavailableCount = list.filter((item) => item?.state === "unavailable").length;

  return {
    home_mode: modeEntity
      ? {
          id: modeEntity.entity_id,
          label: modeEntity.state || "Unknown"
        }
      : null,
    alerts: unavailableCount
      ? [
          {
            id: "ha-unavailable",
            severity: "warning",
            title: `${unavailableCount} entities unavailable`,
            age_s: 0
          }
        ]
      : [],
    connectivity: [
      {
        id: "ha-core",
        label: "Home Assistant",
        state: "ok",
        detail: "Connected"
      }
    ],
    devices: []
  };
}

export async function getHaSnapshot({ haHost, token, validateSnapshot }) {
  try {
    const raw = await fetchHaRaw({ haHost, token });
    const normalized = normalizeHaSnapshot(raw);
    const result = validateData(validateSnapshot, normalized);
    if (!result.ok) {
      console.error("HA snapshot validation failed:", result.errors);
      return buildFallbackSnapshot();
    }
    return normalized;
  } catch (error) {
    error.code = "HA_UNAVAILABLE";
    throw error;
  }
}
