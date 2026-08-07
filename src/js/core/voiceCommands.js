import { switchView, getCurrentView } from "./viewManager.js";
import { setVoiceState } from "./voiceOverlay.js";
import {
  isVoiceSessionEnabled,
  submitTranscripts,
  registerLocalLane
} from "./voiceSession.js";
import { speak } from "./tts.js";
import { resetIdleTimer } from "../modules/screensaver.js";
import { triggerGoodnight } from "../modules/goodnightRoutine.js";
import { generateBriefing } from "../modules/aiBriefing.js";
import { matchIntent } from "../services/localIntents.js";
import { answer } from "../services/localAnswers.js";
import { voiceSnapshot, refreshVoiceCache, rememberReply } from "../services/voiceSnapshot.js";
import { showVocabularyCard } from "../modules/voiceRail.js";
import { WEATHER_LAT, WEATHER_LON } from "../config/config.js";

const VIEW_ORDER = ["home", "weather", "cameras", "timeline"];

const VIEW_LABELS = {
  home: "Home",
  weather: "Weather",
  cameras: "Cameras",
  timeline: "Timeline",
  status: "Status",
  briefing: "Briefing",
};

const VIEW_PHRASES = {
  home:     "Home, sweet home.",
  weather:  "Here's the weather, gorgeous.",
  cameras:  "Cameras coming up.",
  timeline: "Here's what's coming up.",
  status:   "Showing system status.",
  briefing: "Here's your briefing.",
};

// --- Navigation ---

const NAV_KEYWORD_MAP = [
  { keywords: ["home", "main"],                          view: "home" },
  { keywords: ["weather", "forecast"],                   view: "weather" },
  { keywords: ["camera", "cameras"],                      view: "cameras" },
  { keywords: ["calendar", "schedule", "agenda", "today"], view: "timeline" },
  { keywords: ["status", "system"],                      view: "status" },
  { keywords: ["briefing", "brief", "morning"],          view: "briefing" },
];

function nextViewId() {
  const idx = VIEW_ORDER.indexOf(getCurrentView());
  return VIEW_ORDER[(idx + 1) % VIEW_ORDER.length];
}

function prevViewId() {
  const idx = VIEW_ORDER.indexOf(getCurrentView());
  return VIEW_ORDER[(idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length];
}

// --- Question handlers ---
// Each returns a string to speak, or null if data unavailable.

/* The DOM-scraping answerers that used to live here (weather, commute, time,
   today, next event, bins) are gone. They read innerText out of the incumbent's
   markup, which meant they could not be unit-tested without a browser, could
   not be reused by any other surface, and broke silently whenever an element id
   moved. Their replacements are pure and live in
   services/localIntents.js + services/localAnswers.js.

   Only the briefing stays here: it is an AI call, so it is emphatically NOT a
   fast-lane answer and has no business pretending to be one. */

async function answerBriefing() {
  switchView("briefing", { force: true }); // voice request — past the Phase 7 gate
  await speak("One moment.");
  try {
    const summary = await generateBriefing();
    return summary ?? "The briefing isn't available right now.";
  } catch {
    return "The briefing isn't available right now.";
  }
}

// --- Command matching ---

// Routines the lane can fire. Matched through localIntents like everything else
// so there is exactly one place that decides what an utterance means.
const ACTIONS = {
  "action.goodnight": { handler: triggerGoodnight, overlay: "Goodnight" }
};

// The briefing is the one question still routed the old way, because it is an
// AI call and belongs on the slow path by nature.
const BRIEFING_RE = /\bbrief\s+me\b|read\s+(my\s+)?brief(ing)?\b|give\s+me\s+(a\s+)?brief/i;

/** Human-readable overlay label per intent family. */
function overlayFor(id) {
  const [group] = id.split(".");
  return {
    time: "Time", weather: "Weather", cal: "Calendar", house: "Home",
    self: "You", list: "List", camera: "Cameras", meta: "Help", show: "Showing"
  }[group] ?? "Home";
}

function matchNav(text) {
  if (/\bnext\b/.test(text)) return nextViewId();
  if (/\b(back|previous|go back)\b/.test(text)) return prevViewId();
  for (const { keywords, view } of NAV_KEYWORD_MAP) {
    if (keywords.some(k => text.includes(k))) return view;
  }
  return null;
}

// --- Transcript dispatch ---
// The local command lanes (actions → questions → navigation) over a list of
// recogniser alternatives. Handled turns set their own overlay state + TTS.
// Exported as Phase 4's "local lane": the voice session tries this first,
// then falls through to Assist/Claude (docs/vision/phase-4-voice.md).

export async function dispatchTranscripts(transcripts) {
  // The briefing first, because it is explicitly asked for and is the one local
  // match that is allowed to be slow.
  for (const text of transcripts) {
    if (BRIEFING_RE.test(text)) {
      setVoiceState("processing", "Briefing");
      const response = await answerBriefing();
      setVoiceState("success", "Briefing");
      speak(response);
      rememberReply(response);
      return { handled: true };
    }
  }

  // The fast lane. Matching is pure and the snapshot is already in memory, so
  // this whole block is a few milliseconds — no await, no fetch, no round trip.
  for (const text of transcripts) {
    const intent = matchIntent(text);
    if (!intent) continue;

    const action = ACTIONS[intent.id];
    if (action) {
      setVoiceState("processing", action.overlay);
      await action.handler();
      setVoiceState("success", action.overlay);
      return { handled: true };
    }

    // "show me the driveway" — the incumbent has one cameras view rather than
    // per-camera subjects, so every camera resolves there. V3's depth 3 is
    // where the named camera actually earns its own surface.
    if (intent.id === "show.camera") {
      switchView("cameras", { force: true });
      setVoiceState("success", "Cameras");
      speak("Here you go.");
      return { handled: true };
    }
    if (intent.id === "show.sky") {
      switchView("weather", { force: true });
      setVoiceState("success", "Weather");
      return { handled: true };
    }

    const reply = answer(intent, voiceSnapshot({ lat: WEATHER_LAT, lon: WEATHER_LON }));
    if (reply) {
      // "What can I say" is a SCREEN answer. The spoken half is a pointer, not
      // a recital — a voice reading a menu is the failure this whole lane is
      // shaped to avoid. If the rail is flagged off there is no card to show,
      // so fall through and let a real lane handle the question.
      if (reply.showVocabulary && !showVocabularyCard()) continue;
      setVoiceState("success", overlayFor(intent.id));
      speak(reply.speech);
      rememberReply(reply.speech);
      return { handled: true };
    }
    // Matched but no data behind it — fall through to Assist rather than say
    // something empty. A confident non-answer is worse than a slower real one.
  }

  for (const text of transcripts) {
    const view = matchNav(text);
    if (view) {
      switchView(view, { force: true }); // voice nav — past the Phase 7 gate
      setVoiceState("success", VIEW_LABELS[view]);
      speak(VIEW_PHRASES[view]);
      return { handled: true };
    }
  }

  return { handled: false };
}

// --- Recognition lifecycle ---

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
  // Phase 4: hand the session our local lanes (no-op while the flag is off).
  registerLocalLane(dispatchTranscripts);

  // Warm the fast lane's cache and keep it warm. Init-once, never per-event —
  // the answer path must never be the thing that discovers the cache is cold.
  refreshVoiceCache();
  setInterval(refreshVoiceCache, 5 * 60_000);

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    console.info("Voice commands unavailable — SpeechRecognition not supported");
    return;
  }

  recognition = new SpeechRec();
  recognition.lang = "en-AU";
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;
  recognition.continuous = false;

  recognition.onresult = async (event) => {
    const result = event.results[event.resultIndex];
    if (!result?.isFinal) return;

    stopListening();
    resetIdleTimer();

    // Collect all alternatives
    const transcripts = Array.from({ length: result.length }, (_, i) =>
      result[i].transcript.toLowerCase()
    );

    // Phase 4: with the session enabled, it owns the turn — the local lanes
    // run first inside it, then unmatched text falls through to Assist/Claude
    // instead of dead-ending here.
    if (isVoiceSessionEnabled()) {
      await submitTranscripts(transcripts, { source: "webspeech" });
      return;
    }

    // Priority: actions → questions → navigation
    const { handled } = await dispatchTranscripts(transcripts);
    if (!handled) {
      setVoiceState("error", "Unknown command");
      speak("Didn't catch that — try me again?");
    }
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

  console.info("Voice commands ready — motion or Space to activate");
}
