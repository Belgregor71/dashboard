/* ═══════════════════════════════════════════════════════════════════════════
   PRESENCE LIGHT — the house's body.

   Writes exactly three CSS custom properties. All of the visual behaviour lives
   in css/light.css; this module's only job is to keep those three numbers
   honest, because the entire credibility of the listening state rests on them
   being REAL rather than animated on a timer.

   The two couplings that make it real:
     --presence-level  actual microphone RMS, ~12.5Hz, from the wake agent
     --presence-sweep  actual TTS playback position, from the <audio> element
   ═══════════════════════════════════════════════════════════════════════════ */

const root = document.documentElement;

let phase = "idle";
let level = 0;
let levelDecayRaf = null;
let sweepRaf = null;
let stream = null;
let failTimer = null;

/* The wake agent's endpointing threshold is an RMS of 500 on int16 samples, and
   speech in this room runs roughly 500-6000. Normalise against that band rather
   than int16's full range, or every voice sits in the bottom 5% of the scale
   and the rim never visibly moves. */
const RMS_FLOOR = 260;
const RMS_CEIL = 5200;

function normalise(rms) {
  const n = (rms - RMS_FLOOR) / (RMS_CEIL - RMS_FLOOR);
  return Math.max(0, Math.min(1, n));
}

function writeLevel(v) {
  level = v;
  root.style.setProperty("--presence-level", v.toFixed(3));
}

/* Frames arrive at 12.5Hz (one per 80ms audio frame). If the agent stops — the
   turn ended, the bridge dropped — the rim must fall rather than freeze at
   whatever the last syllable happened to be. Decay is the honest default. */
function startDecay() {
  if (levelDecayRaf) return;
  let last = performance.now();
  const step = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    if (level > 0.001) {
      writeLevel(level * Math.exp(-dt * 3.2));
      levelDecayRaf = requestAnimationFrame(step);
    } else {
      writeLevel(0);
      levelDecayRaf = null;
    }
  };
  levelDecayRaf = requestAnimationFrame(step);
}

function stopDecay() {
  if (levelDecayRaf) cancelAnimationFrame(levelDecayRaf);
  levelDecayRaf = null;
}

/** The one way the phase changes. Clears any lingering failure light. */
export function setPhase(next) {
  if (failTimer) { clearTimeout(failTimer); failTimer = null; }
  delete root.dataset.fail;
  phase = next;
  root.dataset.phase = next;

  if (next !== "listening") {
    stopDecay();
    if (next === "idle") writeLevel(0);
  }
  if (next !== "speaking") {
    stopSweep();
    root.style.setProperty("--presence-sweep", "0");
  }
}

/**
 * Show one of the three failures. They are deliberately distinct, because the
 * repair differs by type and because "didn't hear you" and "heard you and
 * can't help" feel nothing alike to the person who said it.
 *   unheard  — nothing arrived
 *   misheard — a transcript arrived that routed nowhere
 *   cannot   — understood, and the house genuinely cannot do it
 */
export function setFailure(kind, holdMs = 2600) {
  setPhase("idle");
  root.dataset.fail = kind;
  failTimer = setTimeout(() => {
    failTimer = null;
    delete root.dataset.fail;
  }, holdMs);
}

/* ── Speaking ───────────────────────────────────────────────────────────────
   The sweep is read from the actual audio element, so it arrives at the last
   word rather than at an estimate of it. That is the whole cue: the room can
   see how much is left and therefore whether to wait or to interrupt.
─────────────────────────────────────────────────────────────────────────── */
export function trackSpeech(audio) {
  if (!audio) return;
  setPhase("speaking");
  stopSweep();

  const step = () => {
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) {
      root.style.setProperty("--presence-sweep", (audio.currentTime / d).toFixed(4));
    }
    sweepRaf = requestAnimationFrame(step);
  };
  sweepRaf = requestAnimationFrame(step);

  // Symmetric teardown on EVERY terminal path. A per-event path that only
  // cleans up on the happy one is how this house accumulated 1,773 listeners.
  const done = () => {
    stopSweep();
    audio.removeEventListener("ended", done);
    audio.removeEventListener("error", done);
    audio.removeEventListener("pause", done);
    setPhase("idle");
  };
  audio.addEventListener("ended", done);
  audio.addEventListener("error", done);
  audio.addEventListener("pause", done);

  // Belt and braces: if none of those ever fire (a stalled decode, a source
  // swapped out from under us) the rAF must still not run forever.
  setTimeout(done, 30_000);
}

function stopSweep() {
  if (sweepRaf) cancelAnimationFrame(sweepRaf);
  sweepRaf = null;
}

/* ── The microphone ─────────────────────────────────────────────────────────
   voice_level rides the EXISTING /api/voice/stream SSE — the same connection
   that already carries transcripts — so this costs no new socket. That matters
   more than it looks: six connections per host is the browser's limit, and two
   never-ending SSE streams have already starved a media request in this house.
─────────────────────────────────────────────────────────────────────────── */
export function initPresenceLight({ enabled = true } = {}) {
  root.dataset.phase = "idle";
  writeLevel(0);
  root.style.setProperty("--presence-sweep", "0");

  window.__presenceLight = () => ({ phase, level: Number(level.toFixed(3)), streamOpen: stream?.readyState === 1 });
  window.__presenceLevel = (rms) => { setPhase("listening"); writeLevel(normalise(rms)); startDecay(); };

  if (!enabled) return;

  try {
    stream = new EventSource("/api/voice/stream");
  } catch {
    return;                       // no mic bridge; the light simply never lifts
  }

  stream.addEventListener("voice_level", (event) => {
    try {
      const { rms } = JSON.parse(event.data);
      if (typeof rms !== "number") return;
      if (phase !== "listening") setPhase("listening");
      writeLevel(normalise(rms));
      startDecay();
    } catch { /* malformed frame — ignore, never throw into the stream */ }
  });
}
