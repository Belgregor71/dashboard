/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Imported by BOTH surfaces (voiceSnapshot is shared), CONNECTED only by V3:
   on the incumbent nothing is ever fresh, so its fetches are unchanged.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══ THE HOUSE STREAM — HOUSE-MIND S2, the browser half ════════════════════
   One EventSource on /api/house/stream (server/services/houseStore.js). Every
   observation the server reads is re-published on the event bus as
   `house:observation` { key, value, at }, synchronously, in arrival order.

   WHAT A CONSUMER DOES WITH IT. Each consumer (houseSnapshot, voiceSnapshot,
   V3's field weather) is behind its OWN flag, and:
     - applies an observation to its cache when its flag is on;
     - skips its own fetch of a key only while `storeFresh(key)` says the store
       delivered that key recently.
   The second rule is the safety net: a dead stream, a stalled source or a page
   that never connected (the incumbent) is simply "not fresh", and the consumer
   goes back to fetching for itself exactly as it did before S2. Nothing waits
   on the stream to be well.

   LEAK DISCIPLINE (24/7 page). Init-once: one EventSource for the page's life,
   one retry timer at most, and `receivedAt` holds one number per source key.
   The native EventSource retries a dropped connection on its own; only a CLOSED
   stream (an HTTP error, a non-SSE reply) needs our backoff.
   ════════════════════════════════════════════════════════════════════════ */

import { emit } from "../core/eventBus.js";

/* Twice the server's five-minute cadence plus a minute: one missed read is
   tolerated, two fall back to the consumer's own fetch. */
export const STORE_FRESH_MS = 11 * 60 * 1000;

const receivedAt = new Map();
let source = null;
let started = false;
let retryTimer = null;
let attempt = 0;

function publish(key, value, at) {
  if (typeof key !== "string" || !key) return;
  receivedAt.set(key, Date.now());
  emit("house:observation", { key, value, at: Number.isFinite(at) ? at : Date.now() });
}

function parse(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

function open() {
  retryTimer = null;
  source = new EventSource("/api/house/stream");
  source.onopen = () => {
    attempt = 0;
  };
  source.onerror = () => {
    // CONNECTING (0) means the browser is already retrying; leave it alone.
    if (!source || source.readyState !== 2) return;
    source.close();
    source = null;
    const delay = Math.min(60_000, 2_000 * 2 ** attempt);
    attempt += 1;
    retryTimer = setTimeout(open, delay);
  };
  source.addEventListener("house_snapshot", (event) => {
    const held = parse(event);
    if (!held || typeof held !== "object") return;
    for (const [key, entry] of Object.entries(held)) publish(key, entry?.value, entry?.at);
  });
  source.addEventListener("house_obs", (event) => {
    const obs = parse(event);
    if (obs) publish(obs.key, obs.value, obs.at);
  });
}

/** Connect once for the page's life. Safe to call again; later calls do nothing. */
export function connectHouseStream() {
  if (started || typeof EventSource === "undefined") return;
  started = true;
  open();
}

/** True while the store delivered `key` within STORE_FRESH_MS. */
export function storeFresh(key, now = Date.now()) {
  const at = receivedAt.get(key);
  return at != null && now - at < STORE_FRESH_MS;
}

/** Read-only state for specs and CDP probes. */
export function houseStreamState() {
  return {
    started,
    readyState: source ? source.readyState : null,
    retrying: retryTimer != null,
    keys: Object.fromEntries(receivedAt)
  };
}
