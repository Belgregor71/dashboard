// main.js

import {
  REFRESH_CALENDAR_MS,
  REFRESH_CLOCK_MS,
  REFRESH_WEATHER_MS
} from "./config/config.js";

import { initBackground } from "./modules/background.js";
import { updateClock } from "./modules/clock.js";
import { fetchWeather } from "./modules/weather.js";
import {
  updateCommuteMap,
  updateCommuteTimes,
  updateCommuteVisibility
} from "./modules/commute.js";

import { refreshCalendar } from "./modules/calendar.js";
import { renderAgenda } from "./modules/agenda.js";

// Calendar refresh now handled entirely inside calendar.js
async function runCalendar() {
  await refreshCalendar();
}
function start() {
  initBackground();

  updateCommuteMap();
  setInterval(updateCommuteMap, 10 * 60 * 1000);

  updateClock();
  setInterval(updateClock, REFRESH_CLOCK_MS);

  fetchWeather();
  setInterval(fetchWeather, REFRESH_WEATHER_MS);

  runCalendar();
  setInterval(runCalendar, REFRESH_CALENDAR_MS);

  updateCommuteVisibility();
  setInterval(updateCommuteVisibility, 60 * 1000);

  updateCommuteTimes();
  setInterval(updateCommuteTimes, 10 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", start);
