// Moments / the emotional timeline. Pure, in the contract of the other service
// reducers (no imports, no DOM, no IO) so it unit-tests in plain node
// (tests/memory.spec.js). Phase 9 (docs/vision/phase-9-remember.md) generalises
// the original travel-only milestone list into a continuous ANTICIPATION arc
// (a slow warming toward any tagged event, not just a countdown number) and adds
// the AFTERGLOW decay window (an occasion's memory drifts back for a few days
// after it passes, then fades). Both are the timeline the memory engine leans on.

const DAY_MS = 86_400_000;
const MILESTONE_DAYS = [30, 14, 7, 3, 1];

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Unchanged from Phase 3 — the calendar footer still renders travel milestones
// verbatim, so the flag-off UI is byte-identical. The anticipation arc below
// supersedes it for the (flag-gated) tone/atmosphere path.
export function computeTravelMoments(events, now = new Date()) {
  return (events || [])
    .filter(ev => ev.category?.id === "travel" && ev.start)
    .map(ev => {
      const days = Math.round((new Date(ev.start) - now) / DAY_MS);
      return MILESTONE_DAYS.includes(days)
        ? { icon: ev.category?.icon || "✈️", text: `${days} day${days === 1 ? "" : "s"} until ${ev.displayTitle || ev.title}` }
        : null;
    })
    .filter(Boolean);
}

// An event worth anticipating: it carries a category (travel/occasion/…) or its
// own tags. Ordinary calendar noise (a dentist slot) has neither and is skipped.
function isAnticipated(ev) {
  return Boolean(ev?.category?.id) || (Array.isArray(ev?.tags) && ev.tags.length > 0);
}

/**
 * The strongest anticipation warmth over the tagged upcoming events.
 * Warmth ramps 0 (a full horizon away) → 1 (arriving today) — a continuous tone
 * input for the House Model / atmosphere, not a milestone string. The runtime
 * decides what to do with the warmth; this only measures it.
 *
 * @returns {{warmth:number, event:(object|null), daysUntil:(number|null)}}
 */
export function anticipationWarmth(events, now = new Date(), { horizonDays = 30 } = {}) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  let best = { warmth: 0, event: null, daysUntil: null };
  for (const ev of events || []) {
    if (!isAnticipated(ev)) continue;
    const at = new Date(ev.start ?? ev.date);
    if (Number.isNaN(at.getTime())) continue;
    const days = (at.getTime() - t) / DAY_MS;
    if (days < 0 || days > horizonDays) continue;
    const warmth = 1 - days / horizonDays; // linear warming toward the day
    if (warmth > best.warmth) best = { warmth: round2(warmth), event: ev, daysUntil: Math.max(0, Math.round(days)) };
  }
  return best;
}

/**
 * Afterglow decay factor for an occasion that has already passed.
 * 1 the day it ends, falling linearly to 0 at `windowDays`, and 0 once fully
 * past — the same self-tearing-down shape as Phase 3's `expiresAt`. The memory
 * engine multiplies this into an entry's context-fit so a just-finished trip
 * drifts back briefly, then lets go.
 *
 * @param {number} daysSince whole/fractional days since the occasion ended
 * @param {number} [windowDays]
 * @returns {number} 0..1
 */
export function afterglowFactor(daysSince, windowDays = 5) {
  if (!Number.isFinite(daysSince) || daysSince < 0 || daysSince > windowDays) return 0;
  return round2(1 - daysSince / windowDays);
}
