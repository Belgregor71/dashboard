// static/js/core/app.js
import lottie from "lottie-web/build/player/lottie_light.js";
window.lottie = lottie;

import { initViews, registerView, switchView } from "./viewManager.js";
// Debug hook: lets kiosk-side CDP / local Playwright drive views that are
// deliberately outside the click-cycle (briefing, status) for verification.
window.__switchView = switchView;
import { initPresence } from "./presence.js";
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
import { initNewsTicker } from "../modules/newsTicker.js";
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
  initViews({ presenceEnabled });
  initPresence({ enabled: presenceEnabled });
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
  initArrivalGreeting();
  initFuelPrices();
  initMorningBriefing();
  initOccasionPopup();
  initEnergySaver();
  initScreensaver({ atmosphereEnabled: isEnabled("ambientAtmospherics", false) });
  initFocusHero({ attentionEnabled: isEnabled("attentionEngine", false) });
  initBomWarningBanner();
  initTonightsMenu();
  initNewsTicker();
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
