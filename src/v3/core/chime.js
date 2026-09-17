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

let ctx = null;
let played = 0;
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

function bell(ac, { hz, at, len }) {
  const t0 = ac.currentTime + 0.02 + at;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, t0 + 0.012);
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

/** Play the chime. Resolves after CHIME_MS whether or not a sound was made. */
export function playChime() {
  const ac = context();
  if (ac) {
    try {
      if (suspendTimer) { clearTimeout(suspendTimer); suspendTimer = null; }
      // Two-handler .then: a refused resume is handled here, not re-thrown.
      if (ac.state === "suspended") ac.resume().then(() => {}, () => {});
      for (const note of NOTES) bell(ac, note);
      played += 1;
    } catch {
      /* no chime is better than no line */
    }
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
      /* Suspend after the notes have rung out, unless another chime started. */
      if (ctx && !suspendTimer) {
        suspendTimer = setTimeout(() => {
          suspendTimer = null;
          if (ctx?.state === "running") ctx.suspend().then(() => {}, () => {});
        }, CHIME_MS);
      }
    }, CHIME_MS);
  });
}

/** Chimes actually scheduled on an AudioContext — the spec's evidence. */
export function chimesPlayed() {
  return played;
}
