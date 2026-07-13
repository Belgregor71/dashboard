// static/js/core/app.js
import lottie from "lottie-web/build/player/lottie_light.js";
window.lottie = lottie;

import { initViews, registerView, switchView } from "./viewManager.js";
// Debug hook: lets kiosk-side CDP / local Playwright drive views that are
// deliberately outside the click-cycle (briefing, status) for verification.
window.__switchView = switchView;
import { initPresence } from "./presence.js";
import { initIntent } from "./intentEngine.js";
import { initRoutineRuntime } from "./routineRuntime.js";
import { initMemoryRuntime } from "./memoryRuntime.js";
import { initPersonalityRuntime } from "./personalityRuntime.js";
import { registerLifecycle } from "./lifecycle.js";
import { initVoiceOverlay } from "./voiceOverlay.js";
import { initVoiceCommands } from "./voiceCommands.js";
import { initMotionTrigger } from "./motionTrigger.js";

import { initBackground } from "../modules/background.js";
import { updateClock } from "../modules/clock.js";
import {
  updateCommuteTimes,
  updateCommuteVisibility
} from "../modules/commute.js";
import { initMiddleSlot } from "../modules/middleSlot.js";
import { initNextEventPanel } from "../modules/nextEventPanel.js";
import { initFocusHero } from "../modules/focusHero.js";

import { refreshCalendar } from "../modules/calendar.js";
import { startWeather } from "../services/weather/renderer.js";
import { initWeatherRadar } from "../services/weather/radar.js";
import { initMediaPanels } from "../modules/mediaPanels.js";
import { initTodoPanels } from "../modules/todo.js";
import { initPlexStatus } from "../modules/plexStatus.js";
import { initArrActivity } from "../modules/arrActivity.js";
import { initMediaStatus } from "../modules/mediaStatus.js";
import { initCameraPopupOverlay } from "../modules/cameraPopupOverlay.js";
import { initCameraTiles } from "../modules/cameraTiles.js";
import { initHomeAssistantTodayPanel } from "../modules/haToday.js";
import { initEnergySaver } from "../modules/energySaver.js";
import { initScreensaver } from "../modules/screensaver.js";
import { initDoorbellAlert } from "../modules/doorbellAlert.js";
import { initBinReminder } from "../modules/binReminder.js";
import { initTimeContext } from "../modules/timeContext.js";
import { initArrivalGreeting } from "../modules/arrivalGreeting.js";
import { initFuelPrices } from "../modules/fuelPrices.js";
import { initMorningBriefing } from "../modules/morningBriefing.js";
import { initOccasionPopup } from "../modules/occasionPopup.js";
import { initBomWarningBanner } from "../modules/bomWarningBanner.js";
import { initTonightsMenu } from "../modules/tonightsMenu.js";
import { initHealthIndicator } from "../modules/healthIndicator.js";
import { createStatusView } from "../modules/systemStatus.js";
import { createBriefingView } from "../views/briefingView.js";
import { createWeatherView } from "../views/weatherView.js";

import { connectHA } from "../services/homeAssistant/client.js";
import { registerHAEvents } from "../services/homeAssistant/events.js";

// Small helper: feature flags with sensible defaults
function isEnabled(featureName, defaultValue = true) {
  const cfg = window.CONFIG || {};
  const features = cfg.features || {};
  if (typeof features[featureName] === "boolean") return features[featureName];
  return defaultValue;
}

export function startApp() {
  console.log("Dashboard starting…");
  initMiddleSlot();

  registerView("home", {});
  registerView("timeline", {});
  registerView("cameras", {});
  registerView("weather", createWeatherView());
  registerView("status", createStatusView());
  registerView("briefing", createBriefingView());

  // Phase 1 presence runtime — off by default, gated by the feature flag so it
  // ships reversibly. When on, it names the presence mode and disables the
  // dead click-cycle. See docs/vision/phase-1-presence-runtime.md.
  const presenceEnabled = isEnabled("presenceRuntime", false);
  initViews({ presenceEnabled, substrateEnabled: isEnabled("ambientSubstrate", false) });

  // Design-system rollout (docs/design/DESIGN_ROLLOUT.md) — flags that only
  // restyle via CSS mark the <body> so the scoped rules engage. Flag-off adds no
  // class → byte-identical. WP-B: the bare Glance/Lean-in top row.
  if (isEnabled("bareTopRow", false)) document.body.classList.add("bare-top-row");
  initPresence({ enabled: presenceEnabled });
  // Phase 6 House Model — a pure reducer over slices the store already carries,
  // gated off by default so it ships reversibly. When on, it names the room's
  // posture and the attention gate reads it. See docs/vision/phase-6-intent.md.
  initIntent({ enabled: isEnabled("houseIntent", false) });
  // Phase 8 "Learn Without Asking" — a passive observer that folds household
  // rhythms into bounded on-device aggregates and, above a confidence threshold,
  // sharpens intent + attention. Off by default → no observation, no writes.
  // See docs/vision/phase-8-learn.md.
  initRoutineRuntime({ enabled: isEnabled("routineLearning", false) });
  // Phase 9 "Remember on Purpose" — structured, rarity-budgeted memory the house
  // holds, surfaced through the Phase 2 queue as a Low-band non-interrupt
  // candidate. Off by default → Phase 3's on-this-day path is unchanged.
  // See docs/vision/phase-9-remember.md.
  initMemoryRuntime({ enabled: isEnabled("memoryEngine", false) });
  // Phase 10 "One Character" — one temperament authority every surfacing path
  // routes through (voice, silence, motion timing, celebration) + a rationed
  // delight registry. Must init before initFocusHero so collectDelight is live
  // for the attention queue. Off by default → every path keeps its current tone.
  // See docs/vision/phase-10-temperament.md.
  initPersonalityRuntime({ enabled: isEnabled("personality", false) });
  registerLifecycle();
  initVoiceOverlay();
  initVoiceCommands();
  initMotionTrigger();

  const cfg = window.CONFIG || {};

  // -----------------------
  // Background (rotating photos + tint)
  // -----------------------
  if (isEnabled("background", true)) {
    initBackground();
  } else {
    console.info("Background disabled");
  }

  // -----------------------
  // Clock
  // -----------------------
  if (isEnabled("clock", true)) {
    updateClock();
    const clockMs = cfg.clock?.refreshMs ?? 1000;
    setInterval(updateClock, clockMs);
  } else {
    console.info("Clock disabled");
  }

  // -----------------------
  // Weather (new services renderer)
  // -----------------------
  if (isEnabled("weather", true)) {
    startWeather();
    const weatherMs = cfg.weather?.refreshMs ?? 10 * 60 * 1000;
    setInterval(startWeather, weatherMs);
    initWeatherRadar();
  } else {
    console.info("Weather disabled");
  }

  // -----------------------
  // Calendar
  // -----------------------
  if (isEnabled("calendar", true)) {
    refreshCalendar();
    const calendarMs = cfg.calendar?.refreshMs ?? 60_000;
    setInterval(refreshCalendar, calendarMs);
    initNextEventPanel();
  } else {
    console.info("Calendar disabled");
  }

  // -----------------------
  // Commute
  // -----------------------
  if (isEnabled("commute", true)) {
    updateCommuteVisibility();
    updateCommuteTimes();

    setInterval(updateCommuteVisibility, 60 * 1000);
    setInterval(updateCommuteTimes, 10 * 60 * 1000);
  } else {
    console.info("Commute disabled");
  }

  // -----------------------
  // Home Assistant
  // -----------------------
  initMediaPanels();
  initTodoPanels();
  initPlexStatus({
    refreshMs: cfg.plex?.refreshMs ?? 30_000,
    enabled: isEnabled("plex", true)
  });
  initCameraTiles();
  initArrActivity();
  initMediaStatus();
  initCameraPopupOverlay();
  initDoorbellAlert();    // must be after initCameraPopupOverlay so cameras view wins
  initBinReminder();
  initTimeContext();
  // Study 03 (WP3) — away->home greeting gets the glass card treatment (docs/design/).
  initArrivalGreeting({ arrivalCardEnabled: isEnabled("arrivalCard", false) });
  initFuelPrices();
  initMorningBriefing();
  initOccasionPopup();
  initEnergySaver();
  initScreensaver({
    atmosphereEnabled: isEnabled("ambientAtmospherics", false),
    // Phase 7 — lift the atmosphere token onto the shared root so the awake
    // dashboard carries the mood too (docs/vision/phase-7-dissolve.md).
    substrateEnabled: isEnabled("ambientSubstrate", false),
    // Phase 9.5 — source the ambient photo pool from Immich (docs/vision/photo-source-immich.md).
    immichEnabled: isEnabled("immichPhotos", false),
    // Study 05 (WP1) — ambient-clock treatment: tabular face + sun-altitude dim (docs/design/).
    ambientClockEnabled: isEnabled("ambientClock", false),
    // Study 01 (WP4) — the tender ambient memory lane: wordless Mode-0 surface (docs/design/).
    ambientMemoryEnabled: isEnabled("ambientMemory", false)
  });
  initFocusHero({
    attentionEnabled: isEnabled("attentionEngine", false),
    // Study 02 — length-responsive hero-line type scale (docs/design/).
    heroTypeEnabled: isEnabled("heroType", false),
    // Study 01 (WP2) — DWELL stack cards get the full glass system (docs/design/).
    leanInStackEnabled: isEnabled("leanInStack", false)
  });
  initBomWarningBanner();
  initTonightsMenu();
  initHealthIndicator();

  if (isEnabled("homeAssistant", false)) {
    initHomeAssistantTodayPanel();
    registerHAEvents();
    connectHA();
  } else {
    const haStatus = document.getElementById("ha-status");
    if (haStatus) haStatus.hidden = true;
    console.info("Home Assistant disabled");
  }

  console.log("Dashboard ready");
}

// Auto-start
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
