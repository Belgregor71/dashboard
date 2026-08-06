// Sleep quality from the CPAP (ResMed myAir), for the morning briefing.
//
// ⚠ ON-DEVICE ONLY. This is health data and it must never reach the AI briefing
// prompt, which is sent to Anthropic. `buildBriefPayload` in aiBriefing.js builds
// an explicit named allowlist of derived strings rather than spreading ctx, so
// ctx.sleep cannot leak by accident — and tests/sleep-summary.spec.js pins that
// allowlist so adding a `sleepText` line fails the suite instead of shipping.
//
// Pure: no DOM, no storage, no imports. Unit-tested in plain node.

const SCORE_ENTITY = "sensor.cpap_total_myair_score";
const AHI_ENTITY = "sensor.cpap_ahi_events_per_hour";
const DATE_ENTITY = "sensor.most_recent_sleep_date";

// myAir's total score is 0–100. The bands are ResMed's own published reading of
// it; the words are ours, because "97" tells you nothing at a glance and a wall
// display is read from three metres away.
const BANDS = [
  { min: 85, label: "Slept well" },
  { min: 70, label: "Slept ok" },
  { min: 51, label: "Patchy night" },
  { min: 0, label: "Rough night" }
];

// A CPAP that wasn't worn, or a NAS that didn't sync, leaves yesterday's reading
// sitting there looking current. Stale sleep data is worse than none: it would
// cheerfully tell you that you slept well on a night you were up with a migraine.
const MAX_AGE_DAYS = 1;

function numberFrom(entities, id) {
  const raw = entities?.[id]?.state;
  const value = Number(raw);
  // "unknown"/"unavailable" coerce to NaN — treat as absent, not as zero.
  return Number.isFinite(value) ? value : null;
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function bandFor(score) {
  return BANDS.find((band) => score >= band.min)?.label ?? null;
}

/**
 * @returns {{ label:string, score:number, ahi:(number|null), date:string, ageDays:number }|null}
 */
export function sleepSummary(entities = {}, now = new Date()) {
  const score = numberFrom(entities, SCORE_ENTITY);
  if (score === null || score < 0 || score > 100) return null;

  const date = parseLocalDate(entities?.[DATE_ENTITY]?.state);
  if (!date) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const ageDays = Math.round((today - date) / (24 * 60 * 60 * 1000));
  // A future-dated reading is a clock problem, not a good night's sleep.
  if (ageDays < 0 || ageDays > MAX_AGE_DAYS) return null;

  return {
    label: bandFor(score),
    score,
    ahi: numberFrom(entities, AHI_ENTITY),
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    ageDays
  };
}
