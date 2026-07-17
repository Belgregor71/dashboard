import { switchView, getCurrentView } from "./viewManager.js";
import { setVoiceState } from "./voiceOverlay.js";
import { speak } from "./tts.js";
import { resetIdleTimer } from "../modules/screensaver.js";
import { triggerGoodnight } from "../modules/goodnightRoutine.js";
import { generateBriefing } from "../modules/aiBriefing.js";

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
  home:     "Switching to home.",
  weather:  "Here's the weather.",
  cameras:  "Showing cameras.",
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

function answerWeather() {
  const temp = document.getElementById("current-temp")?.textContent?.trim();
  const cond = document.getElementById("current-conditions")?.textContent?.trim();
  const range = document.getElementById("weather-range")?.textContent?.trim();
  if (!temp && !cond) return "Weather data isn't available right now.";
  let response = `It's currently ${temp}`;
  if (cond) response += ` and ${cond.toLowerCase()}`;
  if (range) response += `. ${range}`;
  return response + ".";
}

function answerCommute() {
  const greg  = document.getElementById("commute-greg")?.textContent?.trim();
  const brett = document.getElementById("commute-brett")?.textContent?.trim();
  if (!greg && !brett) return "Commute times aren't available right now.";
  const parts = [];
  if (greg)  parts.push(greg.replace("–", "is").replace("-", "is"));
  if (brett) parts.push(brett.replace("–", "is").replace("-", "is"));
  return parts.join(". ") + ".";
}

function answerTime() {
  const now = new Date();
  return `It's ${now.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })}.`;
}

async function answerToday() {
  try {
    const res  = await fetch("/api/calendar/all");
    const data = await res.json();
    const today = new Date();
    const todayStr = today.toDateString();

    const events = (data.events ?? data ?? []).filter(ev => {
      const d = new Date(ev.start ?? ev.startDate ?? ev.date);
      return d.toDateString() === todayStr;
    });

    if (events.length === 0) return "Nothing on the calendar for today.";

    const names = events
      .slice(0, 4)
      .map(ev => ev.title ?? ev.summary ?? "Untitled event");

    if (names.length === 1) return `You have ${names[0]} today.`;
    const last = names.pop();
    return `Today you have ${names.join(", ")}, and ${last}.`;
  } catch {
    return "I couldn't fetch today's events right now.";
  }
}

function answerNextEvent() {
  const name = document.getElementById("next-event-name")?.textContent?.trim();
  const meta = document.getElementById("next-event-meta")?.textContent?.trim();
  if (!name) return "No upcoming events found.";
  return meta ? `Next up: ${name}. ${meta}.` : `Next up: ${name}.`;
}

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

async function answerBins() {
  try {
    const res  = await fetch("/api/bins");
    const data = await res.json();
    if (!data.configured) return "Bin collection isn't configured on this dashboard.";
    if (!data.due)        return "No bins due today or tonight.";
    const binNames = { red: "general waste", yellow: "recycling", green: "organics" };
    const names = (data.bins ?? []).map(b => binNames[b] ?? b);
    if (names.length === 1) return `${data.label}: ${names[0]}.`;
    const last = names.pop();
    return `${data.label}: ${names.join(", ")} and ${last}.`;
  } catch {
    return "I couldn't check the bin schedule right now.";
  }
}

// --- Command matching ---

// Actions: fire-and-forget routines. Handler runs, overlay shows name, no TTS return value.
const ACTION_MAP = [
  {
    patterns: [/\bgood\s*night\b|\bnight\s*night\b|\bsleep\s*mode\b/],
    handler: triggerGoodnight,
    overlay: "Goodnight",
  },
];

function matchAction(text) {
  for (const { patterns, handler, overlay } of ACTION_MAP) {
    if (patterns.some(p => p.test(text))) return { handler, overlay };
  }
  return null;
}

const QUESTION_MAP = [
  {
    patterns: [/weather|temperature|how.s outside|outside like/],
    handler: answerWeather,
    overlay: "Weather",
  },
  {
    patterns: [/commute|drive|traffic|how long.*work|long.*get.*work/],
    handler: answerCommute,
    overlay: "Commute",
  },
  {
    patterns: [/what.*time|time is it/],
    handler: answerTime,
    overlay: "Time",
  },
  {
    patterns: [/what.*on today|today.*happening|happening today|today.*agenda|what.*going on/],
    handler: answerToday,
    overlay: "Today",
  },
  {
    patterns: [/next event|what.*next|coming up/],
    handler: answerNextEvent,
    overlay: "Next Event",
  },
  {
    patterns: [/\bbin(s)?\b|recycling|rubbish|trash|garbage.*day|bin.*day|what.*bin/],
    handler: answerBins,
    overlay: "Bins",
  },
  {
    patterns: [/\bbrief\s+me\b|read\s+(my\s+)?brief(ing)?\b|give\s+me\s+(a\s+)?brief/i],
    handler: answerBriefing,
    overlay: "Briefing",
  },
];

function matchQuestion(text) {
  for (const { patterns, handler, overlay } of QUESTION_MAP) {
    if (patterns.some(p => p.test(text))) return { handler, overlay };
  }
  return null;
}

function matchNav(text) {
  if (/\bnext\b/.test(text)) return nextViewId();
  if (/\b(back|previous|go back)\b/.test(text)) return prevViewId();
  for (const { keywords, view } of NAV_KEYWORD_MAP) {
    if (keywords.some(k => text.includes(k))) return view;
  }
  return null;
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

    // Priority: actions → questions → navigation

    // Actions: routines that handle their own TTS internally
    for (const text of transcripts) {
      const action = matchAction(text);
      if (action) {
        setVoiceState("processing", action.overlay);
        await action.handler();
        setVoiceState("success", action.overlay);
        return;
      }
    }

    // Questions: fetch data and speak the answer
    for (const text of transcripts) {
      const question = matchQuestion(text);
      if (question) {
        setVoiceState("processing", question.overlay);
        const response = await question.handler();
        setVoiceState("success", question.overlay);
        speak(response);
        return;
      }
    }

    for (const text of transcripts) {
      const view = matchNav(text);
      if (view) {
        switchView(view, { force: true }); // voice nav — past the Phase 7 gate
        setVoiceState("success", VIEW_LABELS[view]);
        speak(VIEW_PHRASES[view]);
        return;
      }
    }

    setVoiceState("error", "Unknown command");
    speak("Didn't catch that.");
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
