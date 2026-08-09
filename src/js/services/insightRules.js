/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

// Ambient insight rules — pure functions over the shared briefing context.
// No imports, no DOM, no storage: everything is passed in, so the whole
// module unit-tests in plain node (tests/insights.spec.js).
//
// Each rule returns a candidate { id, icon, score, text, cooldownMs } or
// null. `id` doubles as the cooldown key, so it should be unique per
// *instance* of the situation (per event, per bin night) — that is what
// stops the same nudge nagging every 5 minutes.

const MIN_SCORE = 40;

// ── Helpers ────────────────────────────────────────────────────

function minutesUntil(date, now) {
  return Math.round((date.getTime() - now.getTime()) / 60_000);
}

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ── Rules ──────────────────────────────────────────────────────

/**
 * Concrete leave-by for the next event with a routable location.
 * The engine does the geocode + live-traffic routing (rules stay pure) and
 * hands us `ctx.nextEventDrive` = { title, start, minutes, delayMin, leaveBy,
 * leaveByStr }. We surface it once leaving is on the horizon.
 */
export function leaveBy(ctx, now) {
  const d = ctx.nextEventDrive;
  if (!d || !Number.isFinite(d.minutes)) return null;
  const leaveByDate = d.leaveBy instanceof Date ? d.leaveBy : new Date(d.leaveBy);
  if (Number.isNaN(leaveByDate.getTime())) return null;

  const mins = minutesUntil(leaveByDate, now);
  // Nudge once leaving is on the horizon; drop it once you're well overdue.
  if (mins > 45 || mins < -5) return null;

  const delay = Number.isFinite(d.delayMin) ? d.delayMin : 0;
  const traffic = delay >= 2 ? `, +${delay} min in traffic` : "";
  const text = `Leave by ${d.leaveByStr} for ${d.title} — ${d.minutes} min drive${traffic}.`;

  return {
    id: `leave-by:${d.title}:${new Date(d.start).toISOString()}`,
    icon: "🚗",
    score: 84 + Math.round((45 - mins) / 3), // closer to leave-time → more urgent
    text,
    cooldownMs: 2 * 60 * 60 * 1000
  };
}

/** Bins go out tonight and rain is likely → beat the weather. */
export function binWeatherClash(ctx, now) {
  if (!ctx.bins?.eve) return null;
  if ((ctx.weather?.rainChancePct ?? 0) < 50) return null;

  const colours = (ctx.bins.colours ?? []).join(" + ");
  return {
    id: `bin-weather:${dateKey(now)}`,
    icon: "🗑️",
    score: 60,
    text: `Bins out tonight${colours ? ` (${colours})` : ""} — rain's coming, worth beating it.`,
    cooldownMs: 12 * 60 * 60 * 1000
  };
}

/**
 * True when `price` sits near the bottom of the recent price cycle.
 * `fuelHistory` is a { "yyyy-m-d": price } map maintained by the runtime.
 * The single source of truth for "cheap enough to mention" — the insight rule
 * below and the AI briefing both gate on it, so fuel only ever surfaces at the
 * bottom of the cycle, not every day.
 */
export function isFuelCycleLow(price, fuelHistory = {}) {
  if (price == null) return false;

  const prices = Object.values(fuelHistory).filter((p) => Number.isFinite(p));
  if (prices.length < 7) return false; // not enough cycle history yet

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  if (range < 12) return false; // flat fortnight — no cycle to call
  return price <= min + range * 0.2;
}

/**
 * Fuel near the bottom of the local price cycle.
 */
export function fuelCycleLow(ctx, now, { fuelHistory = {} } = {}) {
  const price = ctx.fuel?.price;
  if (!isFuelCycleLow(price, fuelHistory)) return null;

  return {
    id: `fuel-low:${dateKey(now)}`,
    icon: "⛽",
    score: 55,
    text: `Unleaded's ${price}c at ${ctx.fuel.name} — bottom of the cycle.`,
    cooldownMs: 48 * 60 * 60 * 1000
  };
}

/** Evening heads-up: rain tomorrow morning before an early start. */
export function tomorrowRainEarlyStart(ctx, now) {
  if (now.getHours() < 17) return null;
  if ((ctx.tomorrowWeather?.rainChancePct ?? 0) < 60) return null;

  const first = (ctx.calendar?.tomorrow ?? []).find(
    (ev) => !ev.allDay && ev.start && ev.start.getHours() < 10
  );
  if (!first) return null;

  return {
    id: `tomorrow-rain:${dateKey(now)}`,
    icon: "🌧️",
    score: 50,
    text: `Rain's likely tomorrow morning and ${first.title}'s at ${first.time} — allow extra time.`,
    cooldownMs: 18 * 60 * 60 * 1000
  };
}

export const RULES = [leaveBy, binWeatherClash, fuelCycleLow, tomorrowRainEarlyStart];

// ── Evaluation & selection ─────────────────────────────────────

/** Run every rule; return candidates sorted best-first. */
export function evaluateInsights(ctx, now = new Date(), extras = {}) {
  return RULES.map((rule) => {
    try {
      return rule(ctx, now, extras);
    } catch {
      return null; // one bad rule must never take down the line
    }
  })
    .filter(Boolean)
    .filter((c) => c.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
}

/**
 * Pick the best candidate not on cooldown. `cooldowns` is { id: expiresAt }.
 * The currently-showing insight is exempt from its own cooldown so it can
 * keep displaying for its lifetime rather than vanishing after one pick.
 */
export function pickInsight(candidates, { cooldowns = {}, now = new Date(), currentId = null } = {}) {
  return (
    candidates.find(
      (c) => c.id === currentId || !cooldowns[c.id] || cooldowns[c.id] <= now.getTime()
    ) ?? null
  );
}

/** Returns updated cooldown map with this candidate claimed and stale entries pruned. */
export function claimCooldown(candidate, { cooldowns = {}, now = new Date() } = {}) {
  const next = { ...cooldowns, [candidate.id]: now.getTime() + candidate.cooldownMs };
  for (const [id, expires] of Object.entries(next)) {
    if (expires <= now.getTime()) delete next[id];
  }
  return next;
}

/** Rolling fuel-price history: record today's price, drop entries older than 14 days. */
export function recordFuelPrice(fuelHistory, price, now = new Date()) {
  if (!Number.isFinite(price)) return fuelHistory;
  const next = { ...fuelHistory, [dateKey(now)]: price };
  const cutoff = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  for (const key of Object.keys(next)) {
    const [y, m, d] = key.split("-").map(Number);
    if (new Date(y, m - 1, d).getTime() < cutoff) delete next[key];
  }
  return next;
}
