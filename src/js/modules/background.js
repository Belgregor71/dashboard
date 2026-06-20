import { BACKGROUND_INTERVAL } from "../config/config.js";
import { fetchHolidaysForYear } from "../services/calendar/holidays.js";

let backgroundImages = [];
let currentBgIndex = -1;

function getTintClassForNow() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return "tint-morning";
  if (hour >= 10 && hour < 17) return "tint-day";
  if (hour >= 17 && hour < 20) return "tint-evening";
  return "tint-night";
}

const SEASON_CLASSES = ["season-summer", "season-autumn", "season-winter", "season-spring"];
function getSeasonClassForNow() {
  // Southern Hemisphere mapping (this dashboard is QLD-based, same region
  // already hardcoded in src/js/services/calendar/holidays.js)
  const month = new Date().getMonth(); // 0-11
  if ([11, 0, 1].includes(month)) return "season-summer";
  if ([2, 3, 4].includes(month)) return "season-autumn";
  if ([5, 6, 7].includes(month)) return "season-winter";
  return "season-spring";
}

const WEATHER_BG_CLASSES = ["weather-bg-storm", "weather-bg-rain", "weather-bg-clear"];
function getWeatherBgClass() {
  const cond = document.getElementById("current-conditions")?.textContent?.trim() || "";
  if (!cond) return null;
  if (/storm/i.test(cond)) return "weather-bg-storm";
  if (/rain|shower|drizzle/i.test(cond)) return "weather-bg-rain";
  return "weather-bg-clear";
}

async function checkHoliday() {
  const holidays = await fetchHolidaysForYear(new Date().getFullYear());
  const todayStr = new Date().toDateString();
  const isHoliday = holidays.some(h => new Date(h.start).toDateString() === todayStr);
  document.body.classList.toggle("is-holiday", isHoliday);
}

export function initBackground() {
  loadBackgroundImages();
  updateTint();
  setInterval(updateTint, 10 * 60 * 1000);
  void checkHoliday();
  setInterval(checkHoliday, 24 * 60 * 60 * 1000);
}

function loadBackgroundImages() {
  fetch("/api/photos")
    .then(res => res.json())
    .then(files => {
      if (!Array.isArray(files)) {
        throw new Error("Photo API returned non-array payload");
      }

      backgroundImages = Array.from(new Set(files)).map(file => {
        const trimmed = String(file).replace(/^\/?photos\//, "");
        return `/photos/${encodeURIComponent(trimmed)}`;
      });

      if (backgroundImages.length > 0) {
        rotateBackground();
        setInterval(rotateBackground, BACKGROUND_INTERVAL);
      }
    })
    .catch(err => console.error("Error loading background images:", err));
}

function rotateBackground() {
  if (backgroundImages.length === 0) return;

  let nextIndex;
  do {
    nextIndex = Math.floor(Math.random() * backgroundImages.length);
  } while (nextIndex === currentBgIndex);

  currentBgIndex = nextIndex;

  const img = document.getElementById("background-image");
  if (!img) return;

  img.classList.remove("bg-visible", "bg-animate");

  setTimeout(() => {
    img.src = backgroundImages[currentBgIndex];
    img.onload = () => {
      img.classList.add("bg-visible", "bg-animate");
    };
  }, 500);
}

const TINT_CLASSES = ["tint-morning", "tint-day", "tint-evening", "tint-night"];

function updateTint() {
  const tint = document.getElementById("background-tint");
  const tintClass = getTintClassForNow();

  // Apply to the overlay element (controls background wash colour)
  tint?.classList.remove(...TINT_CLASSES);
  tint?.classList.add(tintClass);

  // Apply to body so CSS can target body.tint-* for accent colours
  document.body.classList.remove(...TINT_CLASSES);
  document.body.classList.add(tintClass);

  document.body.classList.remove(...SEASON_CLASSES);
  document.body.classList.add(getSeasonClassForNow());

  document.body.classList.remove(...WEATHER_BG_CLASSES);
  const weatherClass = getWeatherBgClass();
  if (weatherClass) document.body.classList.add(weatherClass);
}
