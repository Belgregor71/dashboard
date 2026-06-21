let currentAudio = null;

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
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);

    const blob = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    audio.volume = volume;
    currentAudio = audio;

    return new Promise((resolve) => {
      audio.onended = resolve;
      audio.onerror = resolve; // don't block callers on playback error
      audio.play().catch(resolve);
    });
  } catch {
    // Non-fatal — fall back to robotic browser TTS rather than going silent
    return speakWithBrowserTts(text, { rate, pitch, volume });
  }
}

export function silence() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
    window.speechSynthesis.cancel();
  }
}
