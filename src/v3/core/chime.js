/* ═══════════════════════════════════════════════════════════════════════════
   CHIME — the ding before "Timer's done." (features.voiceTimerChime)

   Owner, 2026-09-17, after the first spoken round trip: "at the end of the
   timer it just said timer's done - no ring … I would do a short chime". A
   kitchen timer announces itself with a sound before it has words.

   Synthesised with Web Audio rather than fetched: no asset to serve, nothing
   for the enforced CSP to refuse, no blob URL to revoke. Two soft bell notes,
   high then lower, about 0.9 s.

   ── 24/7 discipline ─────────────────────────────────────────────────────────
   ONE AudioContext for the life of the page, created on the first chime —
   Chromium caps live contexts, so one per ring would run out in a week. A
   running context renders silence continuously, so it is SUSPENDED between
   chimes and resumed for the next. Oscillators are one-shot and are collected
   once stopped and unreferenced.

   Completion is a setTimeout, never an audio `ended` event: the caller's next
   step is SPEECH, and a chime that could not play must never cost the line.
   Every failure path resolves.
   ═══════════════════════════════════════════════════════════════════════════ */

/* High then lower, a major third apart (E6 → C6). Seconds. */
const NOTES = [
  { hz: 1318.5, at: 0, len: 0.45 },
  { hz: 1046.5, at: 0.28, len: 0.6 }
];
const PEAK_GAIN = 0.3;
/** How long the caller waits before speaking: the last note plus a breath. */
export const CHIME_MS = 1_000;

/* The MISS tone (features.v3VoiceMissTone): the wake fired and nothing was
   heard. Owner, 2026-10-24, after a request dropped with only the rim light to
   say so: "put the audible miss after that". Deliberately NOT the timer's
   bell — lower, quieter and shorter, two notes falling a fourth (G5 → D5), so
   a miss can never be mistaken for a timer going off. No words: saying "sorry?"
   to a room that may have been the TV is the noise presence-light avoids. */
const MISS_NOTES = [
  { hz: 784, at: 0, len: 0.22 },
  { hz: 587.3, at: 0.14, len: 0.32 }
];
const MISS_GAIN = 0.16;

let ctx = null;
let played = 0;
let missPlayed = 0;
let suspendTimer = null;

function context() {
  if (ctx) return ctx;
  const Ctor = typeof window !== "undefined" ? (window.AudioContext ?? window.webkitAudioContext) : null;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

function bell(ac, { hz, at, len }, peak = PEAK_GAIN) {
  const t0 = ac.currentTime + 0.02 + at;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  gain.connect(ac.destination);
  // A sine plus a quiet octave reads as a bell rather than a test tone.
  for (const [mult, level] of [[1, 1], [2, 0.18]]) {
    const osc = ac.createOscillator();
    const partial = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = hz * mult;
    partial.gain.value = level;
    osc.connect(partial).connect(gain);
    osc.start(t0);
    osc.stop(t0 + len + 0.05);
  }
}

/* Schedule notes on the one context. True when they were scheduled. */
function ring(notes, peak) {
  const ac = context();
  if (!ac) return false;
  try {
    if (suspendTimer) { clearTimeout(suspendTimer); suspendTimer = null; }
    // Two-handler .then: a refused resume is handled here, not re-thrown.
    if (ac.state === "suspended") ac.resume().then(() => {}, () => {});
    for (const note of notes) bell(ac, note, peak);
    return true;
  } catch {
    return false;   /* no chime is better than no line */
  }
}

/* Suspend once the notes have rung out, unless another chime started. */
function suspendLater() {
  if (ctx && !suspendTimer) {
    suspendTimer = setTimeout(() => {
      suspendTimer = null;
      if (ctx?.state === "running") ctx.suspend().then(() => {}, () => {});
    }, CHIME_MS);
  }
}

/** Play the miss tone. Fire and forget: nothing waits on it. */
export function playMissTone() {
  if (ring(MISS_NOTES, MISS_GAIN)) missPlayed += 1;
  setTimeout(suspendLater, CHIME_MS);
}

/** Miss tones actually scheduled — the spec's evidence. */
export function missTonesPlayed() {
  return missPlayed;
}

/** Play the chime. Resolves after CHIME_MS whether or not a sound was made. */
export function playChime() {
  if (ring(NOTES, PEAK_GAIN)) played += 1;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
      suspendLater();
    }, CHIME_MS);
  });
}

/** Chimes actually scheduled on an AudioContext — the spec's evidence. */
export function chimesPlayed() {
  return played;
}
