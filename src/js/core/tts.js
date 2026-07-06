let currentAudio = null;
let currentAudioUrl = null;

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
    utterance.onend   = resolve;
    utterance.onerror = resolve; // don't block callers on TTS error
    window.speechSynthesis.speak(utterance);
  });
}

export async function speak(text, { rate = 0.92, pitch = 1.0, volume = 1.0 } = {}) {
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

    return new Promise((resolve) => {
      audio.onended = () => { releaseAudioUrl(audioUrl); resolve(); };
      audio.onerror = (e) => { releaseAudioUrl(audioUrl); resolve(e); };
      audio.play().catch(() => {
        releaseAudioUrl(audioUrl);
        resolve();
      });
    });
  } catch (err) {
    console.error("[TEMP-DEBUG] speak() caught error, falling back to browser TTS:", err?.name, err?.message); // TEMP DEBUG
    // Non-fatal — fall back to robotic browser TTS rather than going silent
    return speakWithBrowserTts(text, { rate, pitch, volume });
  }
}

export function silence() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
    releaseAudioUrl(currentAudioUrl);
  }
  if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
    window.speechSynthesis.cancel();
  }
}
