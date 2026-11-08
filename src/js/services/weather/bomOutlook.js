/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by V3 (the wall). docs/design/V3-CUTOVER.md §1 · tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   BOM OUTLOOK — today's forecast in the Bureau's own words (features.v3BomOutlook).

   The `bureau_of_meteorology` integration publishes one flat sensor per field
   per day (`sensor.<place>_short_text_0`, `…_rain_amount_max_0`, …). Open-Meteo
   has better live numbers; what only BOM has is the forecaster's sentence, a
   rain AMOUNT and the fire danger rating. This reads those for day 0 and
   nothing else.

   Pure and config-free: the place is found from the entity ids, so the same
   function serves houseSnapshot (the wall) and voiceSnapshot (the voice).

   ⚠ TODAY ONLY. Every field carries BOM's own `date` (local midnight), and a
   field whose date is not today in Brisbane is treated as absent. Just after
   midnight the integration can still hold yesterday's day 0, and saying
   yesterday's storm as today's is the invented-particular failure exactly.
   ═══════════════════════════════════════════════════════════════════════════ */

const TZ = "Australia/Brisbane";

/** A rain maximum at or above this many mm is worth a line on the wall. */
export const HEAVY_RAIN_MM = 10;

/* AFDRS ratings above Moderate. "No Rating" and Moderate stay quiet. */
const FIRE_LOUD = new Set(["high", "extreme", "catastrophic"]);

const SHORT_TEXT = /^sensor\.([a-z0-9_]+_)short_text_0$/;

const localDay = (now) => new Date(now).toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD

/**
 * @param {Record<string, object>} byId  HA entities keyed by entity_id
 * @param {Date|number} [now]
 * @returns {null | { entityId, short, extended, icon, tempMax, rainMin, rainMax, fireDanger }}
 */
export function bomOutlook(byId, now = new Date()) {
  if (!byId || typeof byId !== "object") return null;
  const entityId = Object.keys(byId).find((id) => SHORT_TEXT.test(id));
  if (!entityId) return null;
  const prefix = `sensor.${entityId.match(SHORT_TEXT)[1]}`;
  const today = localDay(now);

  const read = (field) => {
    const e = byId[`${prefix}${field}_0`];
    const v = e?.state == null ? "" : String(e.state).trim();
    if (!v || v === "unknown" || v === "unavailable") return null;
    if (String(e.attributes?.date ?? "").slice(0, 10) !== today) return null;
    return v;
  };
  const num = (field) => {
    const v = read(field);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const short = read("short_text");
  if (!short) return null;
  return {
    entityId,
    short,
    extended: read("extended_text"),
    icon: read("icon_descriptor"),
    tempMax: num("temp_max"),
    rainMin: num("rain_amount_min"),
    rainMax: num("rain_amount_max"),
    fireDanger: read("fire_danger")
  };
}

export const isStorm = (o) => o?.icon === "storm";
export const isWet = (o) => isStorm(o) || (o?.rainMax ?? 0) >= HEAVY_RAIN_MM;
export const isFireLoud = (o) => FIRE_LOUD.has(String(o?.fireDanger ?? "").toLowerCase());

const sentences = (t) => String(t ?? "").split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);

/** "Showers. Storm developing." -> "Showers, storm developing" */
export function joinShort(short) {
  return sentences(short)
    .map((s) => s.replace(/\.$/, ""))
    .map((s, i) => (i ? s.charAt(0).toLowerCase() + s.slice(1) : s))
    .join(", ");
}

const rainRange = (o, sep) => (o.rainMin != null && o.rainMin !== o.rainMax ? `${o.rainMin}${sep}${o.rainMax}` : `${o.rainMax}`);

/** The wall's line, or null when the day is not worth one. */
export function outlookLine(o) {
  if (!o) return null;
  const bits = [];
  if (isWet(o)) bits.push(o.rainMax != null && o.rainMax > 0 ? `${joinShort(o.short)} · ${rainRange(o, "–")} mm today` : joinShort(o.short));
  if (isFireLoud(o)) bits.push(`Fire danger ${o.fireDanger} today`);
  return bits.length ? bits.join(" · ") : null;
}

/* The second sentence, from BOM's extended text. Its FIRST sentence is always
   the sky cover ("Partly cloudy.") and the short text already speaks for it —
   on a storm day it would say "Showers… Partly cloudy." Wind sentences are
   skipped ("20 to 30 km/h" is a screen's job), and none at all is fine. */
function detail(o) {
  const said = new Set(sentences(o.short).map((s) => s.toLowerCase()));
  return sentences(o.extended).slice(1).find((s) => !said.has(s.toLowerCase()) && !/km\/h/i.test(s)) ?? null;
}

/**
 * What the house says to "what's the weather going to be like today".
 * Facts are BOM's, word for word; the only thing the house adds is that it
 * will be watching a storm, which claims nothing about the sky.
 */
export function outlookSpeech(o) {
  if (!o) return null;
  let first = joinShort(o.short);
  if (isWet(o) && o.rainMax != null && o.rainMax > 0) first += `, ${rainRange(o, " to ")} millimetres`;
  if (o.tempMax != null) first += `, top of ${Math.round(o.tempMax)}`;
  let second = isFireLoud(o) ? `Fire danger's ${o.fireDanger.toLowerCase()} today.` : detail(o);
  if (second && isStorm(o) && !isFireLoud(o)) second = `${second.replace(/\.$/, "")}, and I'll be watching it come in.`;
  return second ? `${first}. ${second}` : `${first}.`;
}
