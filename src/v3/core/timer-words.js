/* The pure half of core/timers.js — constants and words, no DOM, no speech —
   split out so the node specs can import it. timers.js pulls in tts.js and
   presence-light.js, which touch `document` at load. */

export const MAX_TIMERS = 5;
export const MAX_MS = 12 * 3_600_000;
export const RING_EVERY_MS = 30_000;
export const RING_TIMES = 3;
/* How late a timer that ended during a reload may still ring. Two minutes
   covers a deploy restart plus the kiosk's slow first fetch. */
export const LATE_RING_MS = 120_000;

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** 90 000 → "1 minute 30 seconds". Spoken, so no zeros and no colons. */
export function durationPhrase(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h) parts.push(plural(h, "hour"));
  if (m) parts.push(plural(m, "minute"));
  if (s && !h) parts.push(plural(s, "second"));
  return parts.length ? parts.join(" ") : "0 seconds";
}

/** What is LEFT, rounded up the way a person says it. */
export function remainingPhrase(ms) {
  if (ms < 60_000) return plural(Math.max(1, Math.ceil(ms / 1000)), "second");
  if (ms < 3_600_000) return plural(Math.ceil(ms / 60_000), "minute");
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m ? `${plural(h, "hour")} ${plural(m, "minute")}` : plural(h, "hour");
}

/** The pill's clock: "4:07", "1:02:30". Tabular in CSS so it never jitters. */
export function clockText(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
