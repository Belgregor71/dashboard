/* ═══════════════════════════════════════════════════════════════════════════
   AWAY RECAP — "While you were out", behind features.v3AwayRecap.

   arrival.js calls this when the FIRST person comes back to an empty house,
   with the moment the house became empty. The server (services/awayRecap.js)
   owns every rule about what may be said; this module asks once and announces
   what comes back, or nothing. Not spoken: a wrong "someone was at the door"
   said aloud would alarm (owner, 2026-11-20). Glass only.

   Score 75 (High band) and not an interrupt, so the greeting (92) holds the
   glance first and the recap follows it; both share depth 2 for a dweller.
   ═══════════════════════════════════════════════════════════════════════════ */

import { announce } from "./attention.js";

export const RECAP_SCORE = 75;
export const RECAP_LIFE_MS = 10 * 60 * 1000;

let last = null;

/** @param {{ entityId: string, since: number }} arrival */
export function recapAway({ entityId, since }) {
  if (!globalThis.window?.CONFIG?.features?.v3AwayRecap) return Promise.resolve(null);
  if (!Number.isFinite(since)) {
    last = { skipped: "no measured absence" };
    return Promise.resolve(null);
  }
  const now = Date.now();
  return fetch(`/api/camera-captions/recap?since=${since}&until=${now}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      const recap = body?.recap;
      if (!recap?.text) {
        last = { skipped: "nothing to say", since };
        return null;
      }
      announce({
        id: "awayRecap",
        evidence: { key: `ha:${entityId}`, at: now, event: true },
        source: "awayRecap",
        kind: "awayRecap",
        icon: "👀",
        text: recap.text,
        sub: recap.sub ?? undefined,
        score: RECAP_SCORE,
        interrupt: false,
        expiresAt: now + RECAP_LIFE_MS,
        cooldownMs: 0
      });
      last = { text: recap.text, sub: recap.sub, events: recap.events, since, at: new Date(now).toISOString() };
      return recap;
    }, () => {
      last = { skipped: "fetch failed", since };
      return null;
    });
}

/** For __v3() and the specs. */
export const lastRecap = () => last;
