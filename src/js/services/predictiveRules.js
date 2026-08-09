/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

// Predictive candidate rules — pure functions over the shared briefing context
// (Phase 3, docs/vision/phase-3-anticipate.md). Same contract as
// insightRules.js: no imports, no DOM, no storage; everything is passed in, so
// the whole module unit-tests in plain node (tests/insights.spec.js).
//
// Each rule returns a candidate { id, icon, score, text, cooldownMs, source,
// expiresAt? } or null. `id` doubles as the cooldown key. `expiresAt` (epoch
// ms) is the engine's decay handle — rankQueue drops the candidate once it
// passes, so short-lived predictions ("rain in ~15 min") tear themselves down.
//
// Confidence damping (vision: score = importance × urgency × confidence) is
// baked into the returned score, and a probability floor gates low-confidence
// signals out entirely — "damped, not shown as fact".

const MIN_SCORE = 40;
const SOURCE = "predictive";

// ── Helpers ────────────────────────────────────────────────────

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function endOfDay(now) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Stable 15-min bucket key for an absolute time, so a counting-down rain
// window keeps the same id across 5-min refreshes (cooldown/dedup depend on it).
function quarterKey(d) {
  const q = new Date(d);
  q.setMinutes(Math.floor(q.getMinutes() / 15) * 15, 0, 0);
  return q.toISOString().slice(0, 16);
}

// ── Rules ──────────────────────────────────────────────────────

const RAIN_PROB_FLOOR = 50; // below this we don't assert rain is coming

/**
 * Rain is forecast to start soon (Open-Meteo minutely_15 nowcast).
 * `ctx.nowcast` = { startsInMin, probabilityPct, mm } or null.
 * Score 55 + round(prob × 0.25) → Medium→High band, scaled by confidence;
 * a sub-floor probability returns null (never shown). Decays at rain onset.
 */
export function rainIncoming(ctx, now) {
  const nc = ctx.nowcast;
  if (!nc || !Number.isFinite(nc.startsInMin) || nc.startsInMin <= 0) return null;

  const prob = Number(nc.probabilityPct);
  if (!Number.isFinite(prob) || prob < RAIN_PROB_FLOOR) return null;

  const mins = nc.startsInMin;
  const rounded = mins <= 20 ? mins : Math.round(mins / 5) * 5;
  const startAt = new Date(now.getTime() + mins * 60_000);

  const binsOut = Boolean(ctx.bins?.eve || ctx.bins?.due);
  const text = binsOut
    ? `Rain in about ${rounded} min (${prob}%) — bins are still out.`
    : `Rain in about ${rounded} min — ${prob}% chance.`;

  return {
    id: `rain-incoming:${quarterKey(startAt)}`,
    source: SOURCE,
    icon: "🌧️",
    score: 55 + Math.round(prob * 0.25),
    text,
    cooldownMs: 30 * 60 * 1000,
    expiresAt: startAt.getTime() // decays at the start of the rain window
  };
}

/**
 * The bin reminder, in its two windows.
 *
 * The rubbish truck comes early, so the reminder that matters lands the DAY
 * BEFORE (from midday) — `bins.eve`. Collection morning gets a short, sharper
 * `bins.lastChance` until 7am, after which the route goes quiet: nagging about a
 * truck that has already been asks for something no longer possible.
 *
 * When rain is also coming on bin eve, insightRules' `binWeatherClash` (score 60)
 * takes over, so we stand down to avoid a duplicate — that stand-down is the eve
 * case only, since a last chance outranks a tidy bit of weather advice anyway.
 */
export function binNight(ctx, now) {
  const bins = ctx.bins;
  if (!bins) return null;

  const colours = (bins.colours ?? []).join(" + ");
  const suffix = colours ? ` (${colours})` : "";

  if (bins.lastChance) {
    const cutoff = new Date(now);
    cutoff.setHours(7, 0, 0, 0);
    return {
      id: `bin-last-chance:${dateKey(now)}`,
      source: SOURCE,
      icon: "🗑️",
      // Above the eve reminder: same chore, far less time left to do it.
      score: 68,
      text: `Bins${suffix} — last chance, the truck's due.`,
      cooldownMs: 60 * 60 * 1000,
      expiresAt: cutoff.getTime()
    };
  }

  if (!bins.eve) return null;
  if ((ctx.weather?.rainChancePct ?? 0) >= 50) return null; // clash rule owns this

  return {
    id: `bin-night:${dateKey(now)}`,
    source: SOURCE,
    icon: "🗑️",
    score: 50,
    text: `Bins go out tonight${suffix}.`,
    cooldownMs: 4 * 60 * 60 * 1000,
    expiresAt: endOfDay(now).getTime()
  };
}

/**
 * A quiet "on this day" memory — today's anniversary/birthday calendar markers.
 * `ctx.anniversaries` = [{ title }]. Low-band (42) by design: it only ever
 * wins the hero when nothing else is competing (Mode 0/1's earned memory).
 */
export function onThisDay(ctx, now) {
  const items = ctx.anniversaries;
  if (!Array.isArray(items) || items.length === 0) return null;

  const label = String(items[0]?.title ?? "").trim();
  if (!label) return null;

  return {
    id: `on-this-day:${dateKey(now)}:${label}`,
    source: SOURCE,
    icon: "🎉",
    score: 42,
    text: `Today: ${label}.`,
    cooldownMs: 6 * 60 * 60 * 1000,
    expiresAt: endOfDay(now).getTime()
  };
}

export const PREDICTIVE_RULES = [rainIncoming, binNight, onThisDay];

// ── Evaluation ─────────────────────────────────────────────────

/** Run every predictive rule; return candidates sorted best-first. Mirrors evaluateInsights. */
export function evaluatePredictive(ctx, now = new Date(), extras = {}) {
  return PREDICTIVE_RULES.map((rule) => {
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
