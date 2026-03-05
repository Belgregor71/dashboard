// static/js/core/app.js
import { initViews, registerView } from "./viewManager.js";
import { registerLifecycle } from "./lifecycle.js";
import { initVoiceOverlay } from "./voiceOverlay.js";

import { initBackground } from "../modules/background.js";
import { updateClock } from "../modules/clock.js";
import {
  updateCommuteTimes,
  updateCommuteVisibility
} from "../modules/commute.js";
import { initMiddleSlot } from "../modules/middleSlot.js";
import { initNextEventPanel } from "../modules/nextEventPanel.js";

import { refreshCalendar } from "../modules/calendar.js";
import { startWeather } from "../services/weather/renderer.js";
import { initMediaPanels } from "../modules/mediaPanels.js";
import { initTodoPanels } from "../modules/todo.js";
import { initPlexStatus } from "../modules/plexStatus.js";
import { initArrActivity } from "../modules/arrActivity.js";
import { initMediaHome } from "../modules/mediaHome.js";
import { initMediaStatus } from "../modules/mediaStatus.js";
import { initDoorbellOverlay } from "../modules/doorbellOverlay.js";
import { initCameraPopupOverlay } from "../modules/cameraPopupOverlay.js";
import { initCameraMotionView } from "../modules/cameraMotionView.js";
import { initCameraTiles } from "../modules/cameraTiles.js";
import { initHomeAssistantTodayPanel } from "../modules/haToday.js";
import { initEnergySaver } from "../modules/energySaver.js";
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
  registerView("calendar", {});
  registerView("agenda", {});
  registerView("cameras", {});
  registerView("weather", createWeatherView());
  registerView("status", createStatusView());
  registerView("briefing", createBriefingView());

  initViews();
  registerLifecycle();
  initVoiceOverlay();

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
  initMediaHome();
  initMediaStatus();
  initDoorbellOverlay();
  initCameraPopupOverlay();
  initCameraMotionView();
  initEnergySaver();

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
