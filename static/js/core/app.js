// static/js/core/app.js
import { initViews } from "./viewManager.js";
import { registerLifecycle } from "./lifecycle.js";

import { initBackground } from "../modules/background.js";
import { updateClock } from "../modules/clock.js";
import {
  updateCommuteTimes,
  updateCommuteVisibility
} from "../modules/commute.js";

import { refreshCalendar } from "../modules/calendar.js";
import { startWeather } from "../services/weather/renderer.js";
import { initMediaPanels } from "../modules/mediaPanels.js";
import { initTodoPanels } from "../modules/todo.js";
import { initPlexStatus } from "../modules/plexStatus.js";
import { initDoorbellOverlay } from "../modules/doorbellOverlay.js";
import { initCameraMotionView } from "../modules/cameraMotionView.js";
import { initCameraTiles } from "../modules/cameraTiles.js";
import { initHomeAssistantTodayPanel } from "../modules/haToday.js";

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

  initViews();
  registerLifecycle();

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
  initDoorbellOverlay();
  initCameraMotionView();

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
