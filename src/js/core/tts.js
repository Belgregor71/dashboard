/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

let currentAudio = null;
let currentAudioUrl = null;
/* Settles the in-flight speak() promise. Load-bearing for barge-in: silence()
   PAUSES the element, and pause fires no 'ended', so without this the awaiting
   caller waits forever. V3 awaits say() with its `busy` latch held — one
   interrupted reply would have made the house permanently deaf, which is a
   worse failure than the echo this whole change is fixing. */
let currentFinish = null;

/* ── Half duplex ────────────────────────────────────────────────────────────
   The kiosk's microphone can hear its own speakers, and the wake agent spent
   2026-08-08 transcribing the house's replies back into the voice pipeline. It
   cannot tell our voice from a person's, so it has to be TOLD when we are
   talking — and this module is the one chokepoint every surface speaks
   through, incumbent and V3 alike.

   An observer rather than a fetch: with the flag off nothing is installed, and
   this file makes no request it did not make before. Installed by
   voiceSession, which owns the flag and the endpoint. */
let onSpeakingChange = null;
let announced = false;

export function setSpeakingObserver(fn) {
  onSpeakingChange = typeof fn === "function" ? fn : null;
  announced = false;
}

/* Transitions only. speak() opens with silence(), and silence() reports too, so
   an unguarded version posts a redundant "not speaking" before every single
   utterance — a wasted request on each turn, and a state change the agent has
   to process for nothing.

   Reporting must never cost the room its reply, so a throwing observer is
   swallowed here rather than allowed to abort playback. */
function announce(on) {
  const next = on === true;
  if (!onSpeakingChange || next === announced) return;
  announced = next;
  try {
    onSpeakingChange(next);
  } catch {
    /* the answer matters more than the microphone's opinion of it */
  }
}

// Blob object URLs pin the full audio buffer for the lifetime of the page
// unless revoked — on a kiosk that never reloads, every utterance would
// leak its WAV otherwise.
function releaseAudioUrl(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
  if (currentAudioUrl === url) currentAudioUrl = null;
}

function ensureVoices() {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) return resolve(voices);
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      resolve(window.speechSynthesis.getVoices());
    }, { once: true });
  });
}

function pickVoice(voices) {
  const preferred = [
    "Karen",           // macOS/iOS en-AU
    "en-AU",           // any en-AU
    "en-GB",           // fallback British
    "en-US",           // last resort
  ];
  for (const hint of preferred) {
    const match = voices.find(v => v.name.includes(hint) || v.lang.startsWith(hint));
    if (match) return match;
  }
  return voices[0] ?? null;
}

// Fallback path — used only if the self-hosted Kokoro TTS endpoint is
// unreachable, so voice features never go fully silent.
async function speakWithBrowserTts(text, { rate, pitch, volume }) {
  if (!window.speechSynthesis || !text) return;

  const voices = await ensureVoices();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = pickVoice(voices);
  utterance.lang = "en-AU";
  utterance.rate = rate;
  utterance.pitch = pitch;
  utterance.volume = volume;

  return new Promise((resolve) => {
    // The fallback voice comes out of the same speakers, so the mic has to be
    // told about it too — a degraded TTS path is still a talking house.
    const done = () => {
      if (currentFinish === done) currentFinish = null;
      announce(false);
      resolve();
    };
    currentFinish = done;
    utterance.onstart = () => announce(true);
    utterance.onend   = done;
    utterance.onerror = done; // don't block callers on TTS error
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * `onAudio` (optional) hands the caller the <audio> element the moment it is
 * created, so a surface can couple a visual to real playback position rather
 * than to an estimate of it — V3's speaking sweep reads currentTime/duration
 * from it. Additive: callers that omit it are unaffected, and it is never
 * invoked on the browser-TTS fallback path, which has no element to give.
 */
export async function speak(text, { rate = 0.92, pitch = 1.0, volume = 1.0, onAudio = null } = {}) {
  if (!text) return;

  silence();

  try {
    const res = await fetch("/api/tts/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, rate }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);

    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    audio.volume = volume;
    currentAudio = audio;
    currentAudioUrl = audioUrl;
    // Isolated: a throwing observer must not cost the room its reply.
    if (typeof onAudio === "function") {
      try { onAudio(audio); } catch (err) { setTimeout(() => { throw err; }); }
    }

    return new Promise((resolve) => {
      const finish = (value) => {
        if (currentFinish === finish) currentFinish = null;
        announce(false);
        releaseAudioUrl(audioUrl);
        resolve(value);
      };
      currentFinish = finish;
      audio.onended = () => finish();
      audio.onerror = (e) => finish(e);
      // announce(true) on the play() PROMISE, not on the fetch: the round trip
      // to Kokoro can take seconds, and a mic muted for the wait would be deaf
      // through the pause where someone is most likely to speak again.
      // Two-handler .then, never .catch-after: the rejection is handled here,
      // and a trailing .finally() would re-throw it onto a fresh chain.
      audio.play().then(() => announce(true), () => finish());
    });
  } catch (err) {
    // Non-fatal — fall back to robotic browser TTS rather than going silent.
    // Kept at warn level so a primary-TTS (Kokoro) outage is still visible.
    console.warn("[TTS] Kokoro unavailable, using browser fallback:", err?.message);
    return speakWithBrowserTts(text, { rate, pitch, volume });
  }
}

export function silence() {
  // Taken before the teardown below, because finish() clears it.
  const finish = currentFinish;
  currentFinish = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
    releaseAudioUrl(currentAudioUrl);
  }
  if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
    window.speechSynthesis.cancel();
  }
  // Settle whoever is awaiting the reply. pause() fires no 'ended' and
  // cancel() fires no 'end' for an utterance that never started, so without
  // this an interrupted reply leaves its caller awaiting forever — and V3
  // holds its `busy` latch across that await.
  if (finish) finish();
  // Unconditional, and last, for the same reason: neither handler can be
  // relied on to have run. A mic that stays gated after we stop talking is a
  // mic that has stopped listening, which is worse than the echo.
  announce(false);
}
