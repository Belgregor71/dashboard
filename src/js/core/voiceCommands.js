import { switchView, getCurrentView } from "./viewManager.js";
import { setVoiceState } from "./voiceOverlay.js";

const VIEW_ORDER = ["home", "weather", "cameras", "calendar", "agenda", "status", "briefing"];

const VIEW_LABELS = {
  home: "Home",
  weather: "Weather",
  cameras: "Cameras",
  calendar: "Calendar",
  agenda: "Agenda",
  status: "Status",
  briefing: "Briefing",
};

const KEYWORD_MAP = [
  { keywords: ["home", "main"],              view: "home" },
  { keywords: ["weather", "forecast"],       view: "weather" },
  { keywords: ["camera", "cameras"],         view: "cameras" },
  { keywords: ["calendar", "schedule"],      view: "calendar" },
  { keywords: ["agenda", "today"],           view: "agenda" },
  { keywords: ["status", "system"],          view: "status" },
  { keywords: ["briefing", "brief", "morning"], view: "briefing" },
];

function nextViewId() {
  const idx = VIEW_ORDER.indexOf(getCurrentView());
  return VIEW_ORDER[(idx + 1) % VIEW_ORDER.length];
}

function prevViewId() {
  const idx = VIEW_ORDER.indexOf(getCurrentView());
  return VIEW_ORDER[(idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length];
}

function matchTranscript(transcript) {
  const text = transcript.toLowerCase();
  if (/\bnext\b/.test(text)) return nextViewId();
  if (/\b(back|previous)\b/.test(text)) return prevViewId();
  for (const { keywords, view } of KEYWORD_MAP) {
    if (keywords.some(k => text.includes(k))) return view;
  }
  return null;
}

let recognition = null;
let listening = false;

export function isListening() {
  return listening;
}

function stopListening() {
  if (!listening) return;
  listening = false;
  try { recognition?.stop(); } catch {}
}

export function startListening() {
  if (listening || !recognition) return;
  listening = true;
  setVoiceState("listening");
  try {
    recognition.start();
  } catch {
    listening = false;
    setVoiceState("error", "Mic unavailable");
  }
}

export function initVoiceCommands() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    console.info("Voice commands unavailable — SpeechRecognition not supported in this browser");
    return;
  }

  recognition = new SpeechRec();
  recognition.lang = "en-AU";
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const result = event.results[event.resultIndex];
    if (!result?.isFinal) return;

    let matchedView = null;
    for (let i = 0; i < result.length; i++) {
      matchedView = matchTranscript(result[i].transcript);
      if (matchedView) break;
    }

    if (matchedView) {
      switchView(matchedView);
      setVoiceState("success", VIEW_LABELS[matchedView]);
    } else {
      setVoiceState("error", "Unknown command");
    }
    stopListening();
  };

  recognition.onerror = (event) => {
    listening = false;
    if (event.error === "no-speech") {
      setVoiceState("hidden");
    } else if (event.error !== "aborted") {
      setVoiceState("error", "Try again");
    }
  };

  recognition.onend = () => {
    if (listening) {
      setVoiceState("hidden");
      listening = false;
    }
  };

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat) return;
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    event.preventDefault();

    if (listening) {
      stopListening();
      setVoiceState("hidden");
    } else {
      startListening();
    }
  });

  console.info("Voice commands ready — press Space to activate, speak a view name");
}
