import fetch from "node-fetch";
import { recognisedName } from "../../src/js/services/personName.js";

/* Who the cameras can recognise — so their doorbell lines can be pre-warmed.

   The alert speaks `sensor.<camera>_person_name` verbatim, so the only names
   worth warming are the ones that sensor has actually said, or will: what it
   has reported recently (the ground truth — it is Eufy's own spelling of the
   enrolled face) plus the household's `person.*` entities, for a face enrolled
   but not yet seen. Read from Home Assistant at run time and never written to
   config: `src/js/config.js` is tracked and public.

   Bounded on purpose. Every name costs 12 syntheses (6 front-door + 6
   side-gate lines) and 12 cache entries. */

export const MAX_ALERT_NAMES = 6;
const HISTORY_DAYS = 30;
const REQUEST_TIMEOUT_MS = 6000;
const NAME_SENSOR_RE = /^sensor\..+_person_name$/;

/**
 * The names to warm, from an /api/states list and the name sensors' history
 * rows. Pure. Sensor-reported names come first: they are certain to be spoken
 * exactly as written, and the cap must not spend itself on guesses.
 */
export function collectAlertNames(states, historyRows = []) {
  const names = [];
  const seen = new Set();
  const add = (raw) => {
    const name = recognisedName(raw);
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    names.push(name);
  };

  for (const row of historyRows ?? []) add(row?.state);
  for (const entity of states ?? []) {
    const id = entity?.entity_id ?? "";
    if (NAME_SENSOR_RE.test(id)) add(entity.state);
  }
  for (const entity of states ?? []) {
    if ((entity?.entity_id ?? "").startsWith("person.")) add(entity.attributes?.friendly_name);
  }
  return names.slice(0, MAX_ALERT_NAMES);
}

/** The name sensors present in a states list. */
export function nameSensorIds(states) {
  return (states ?? []).map((e) => e?.entity_id ?? "").filter((id) => NAME_SENSOR_RE.test(id));
}

async function getJson(url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HA ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Ask Home Assistant. Throws when HA is unreachable — the caller retries weekly. */
export async function fetchAlertNames({ haHost, token, now = Date.now() }) {
  const base = haHost.replace(/\/$/, "");
  const states = await getJson(`${base}/api/states`, token);

  const rows = [];
  const since = new Date(now - HISTORY_DAYS * 864e5).toISOString();
  const until = new Date(now).toISOString();
  for (const id of nameSensorIds(states)) {
    try {
      const series = await getJson(
        `${base}/api/history/period/${encodeURIComponent(since)}?filter_entity_id=${id}&end_time=${encodeURIComponent(until)}`,
        token
      );
      rows.push(...(series?.[0] ?? []));
    } catch {
      // History is the better source, not the only one — the live state and
      // the person.* entities below still name the household.
    }
  }
  return collectAlertNames(states, rows);
}
