let _voicesLoaded = false;

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

export async function speak(text, { rate = 0.92, pitch = 1.0, volume = 1.0 } = {}) {
  if (!window.speechSynthesis || !text) return;

  silence();

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

export function silence() {
  if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) {
    window.speechSynthesis.cancel();
  }
}
