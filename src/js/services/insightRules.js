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

function maxCommuteDelay(ctx) {
  return Math.max(ctx.commute?.greg?.delayMin ?? 0, ctx.commute?.brett?.delayMin ?? 0);
}

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ── Rules ──────────────────────────────────────────────────────

/** Timed event soon + rain or unusual traffic → leave early. */
export function leaveEarly(ctx, now) {
  const next = (ctx.calendar?.today ?? []).find((ev) => {
    if (ev.allDay || !ev.start) return false;
    const mins = minutesUntil(ev.start, now);
    return mins >= 30 && mins <= 120;
  });
  if (!next) return null;

  const rain = (ctx.weather?.rainChancePct ?? 0) >= 50;
  const delay = maxCommuteDelay(ctx);
  const traffic = delay >= 10;
  if (!rain && !traffic) return null;

  const mins = minutesUntil(next.start, now);
  let text;
  if (rain && traffic) {
    text = `Rain about and traffic's adding ${delay} min — leave early for ${next.title} at ${next.time}.`;
  } else if (traffic) {
    text = `Traffic's adding ${delay} min right now — leave early for ${next.title} at ${next.time}.`;
  } else {
    text = `Rain around when you head out — allow a few extra minutes for ${next.title} at ${next.time}.`;
  }

  return {
    id: `leave-early:${next.title}:${next.start.toISOString()}`,
    icon: "⏰",
    score: 80 + Math.round((120 - mins) / 4), // closer event → more urgent
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
    text: `Bins out tonight${colours ? ` (${colours})` : ""} and rain's on the way — get them out before it hits.`,
    cooldownMs: 12 * 60 * 60 * 1000
  };
}

/**
 * Fuel near the bottom of the local price cycle.
 * `fuelHistory` is a { "yyyy-m-d": price } map maintained by the runtime.
 */
export function fuelCycleLow(ctx, now, { fuelHistory = {} } = {}) {
  const price = ctx.fuel?.price;
  if (price == null) return null;

  const prices = Object.values(fuelHistory).filter((p) => Number.isFinite(p));
  if (prices.length < 7) return null; // not enough cycle history yet

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  if (range < 12) return null; // flat fortnight — no cycle to call
  if (price > min + range * 0.2) return null;

  return {
    id: `fuel-low:${dateKey(now)}`,
    icon: "⛽",
    score: 55,
    text: `Unleaded's ${price}c at ${ctx.fuel.name} — that's the bottom of the price cycle.`,
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

export const RULES = [leaveEarly, binWeatherClash, fuelCycleLow, tomorrowRainEarlyStart];

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
