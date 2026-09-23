/* ═══ THE OBSERVATION STORE — HOUSE-MIND S2 (docs/design/HOUSE-MIND.md §5) ═══
   One sticky last value per observed source, read ONCE and pushed to every
   subscriber over /api/house/stream.

   WHY. Before this, V3 ran two five-minute pollers (houseSnapshot and
   voiceSnapshot) that each fetched weather, calendar and commute on their own
   clock. Two readers of one fact at two moments can disagree, and the glance and
   the voice lane then say different things about the same sky.

   ⚠ LOOPBACK, NOT A REFACTOR. The store reads the house's OWN routes over
   127.0.0.1 rather than calling their internals. The route handlers carry their
   logic inline (commute's 4-minute bound, the health reporting, the calendar
   merge), and lifting five live routes into services to save one hop would
   change code that is on the wall. Loopback keeps the payload BYTE-IDENTICAL to
   what the clients parsed before, so a consumer's parse path does not change.
   Loopback is exempt from the flood ceiling (middleware/security.js).

   ⚠ LAZY. It polls only while somebody is listening. The flag-off build has no
   subscriber, so it makes no request, which keeps the flag-off server identical
   to before and the suite's test server quiet. Values stay after the last
   subscriber leaves and are re-read when stale on the next connect.

   ⚠ LAST GOOD VALUE WINS, as in both client caches it replaces: a failed read
   leaves the previous value standing and pushes nothing. A stale reading beats
   a blank one, and absent is never turned into empty here.

   BOUNDED. One entry per declared source, overwritten in place. No history is
   kept: the log half of the house mind is the server's job with its own
   retention, and this module is not it.
   ════════════════════════════════════════════════════════════════════════ */

import { fetchWithTimeout } from "../utils/fetch.js";

/* The cadence matches the two five-minute pollers this replaces, so a subscriber
   sees data no staler than before. Keys are the store's names, NOT the paths:
   a consumer asks for `weather`, and where it comes from stays the server's
   business. */
export const SOURCES = Object.freeze([
  { key: "weather", path: "/api/weather/now", everyMs: 300_000 },
  { key: "forecast", path: "/api/weather/forecast", everyMs: 300_000 },
  { key: "nowcast", path: "/api/weather/nowcast", everyMs: 300_000 },
  { key: "calendar", path: "/api/calendar/all", everyMs: 300_000 },
  { key: "commute", path: "/api/commute/all", everyMs: 300_000 },
  { key: "bins", path: "/api/bins", everyMs: 300_000 },
  { key: "plex", path: "/api/plex/sessions", everyMs: 300_000 }
]);

const READ_TIMEOUT_MS = 15_000;

/* key -> { value, at } for the last GOOD read. `at` is when it was read, which
   for Plex is the only anchor a playback position has (see houseSnapshot's
   plexAt). */
const latest = new Map();
/* key -> { reads, failures, lastError, lastTryAt } — for /api/house/store and
   for proving on the live box that each source is read once, not six times. */
const stats = new Map(SOURCES.map((s) => [s.key, { reads: 0, failures: 0, lastError: null, lastTryAt: 0 }]));
const subscribers = new Set();
const timers = new Map();
const inFlight = new Map();

function baseUrl() {
  // Same default as server.js; the test server sets PORT explicitly.
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

function publish(key, entry) {
  for (const fn of subscribers) {
    try {
      fn(key, entry);
    } catch (err) {
      // One broken subscriber (a socket mid-close) must not starve the others.
      console.warn(`[house-store] subscriber failed on ${key}: ${err?.message || err}`);
    }
  }
}

/** Read one source now. Concurrent calls for the same key share one request. */
export function readSource(source) {
  if (inFlight.has(source.key)) return inFlight.get(source.key);
  const st = stats.get(source.key);
  st.lastTryAt = Date.now();
  const run = (async () => {
    try {
      const res = await fetchWithTimeout(`${baseUrl()}${source.path}`, {}, READ_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = await res.json();
      const entry = { value, at: Date.now() };
      latest.set(source.key, entry);
      st.reads += 1;
      st.lastError = null;
      publish(source.key, entry);
    } catch (err) {
      st.failures += 1;
      st.lastError = String(err?.message || err);
    }
  })();
  // Two-handler form: cleanup must not re-throw on a fresh chain (CLAUDE.md).
  const done = () => inFlight.delete(source.key);
  run.then(done, done);
  inFlight.set(source.key, run);
  return run;
}

function start() {
  const now = Date.now();
  for (const source of SOURCES) {
    const have = latest.get(source.key);
    if (!have || now - have.at >= source.everyMs) readSource(source);
    timers.set(source.key, setInterval(() => readSource(source), source.everyMs));
  }
}

function stop() {
  for (const t of timers.values()) clearInterval(t);
  timers.clear();
}

/**
 * Listen for every good read. Returns the unsubscribe function, which MUST be
 * called on disconnect: the last one out stops the polling.
 * @param {(key: string, entry: {value: any, at: number}) => void} fn
 */
export function subscribe(fn) {
  subscribers.add(fn);
  if (subscribers.size === 1) start();
  return () => {
    if (!subscribers.delete(fn)) return;
    if (subscribers.size === 0) stop();
  };
}

/** Every held value, as { key: { value, at } }. */
export function snapshot() {
  return Object.fromEntries(latest);
}

/** Read-only state for the status route and specs. */
export function storeStatus() {
  return {
    subscribers: subscribers.size,
    polling: timers.size > 0,
    sources: SOURCES.map((s) => ({
      key: s.key,
      path: s.path,
      everyMs: s.everyMs,
      held: latest.has(s.key),
      at: latest.get(s.key)?.at ?? null,
      ...stats.get(s.key)
    }))
  };
}
