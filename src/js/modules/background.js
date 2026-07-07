import { fetchHolidaysForYear } from "../services/calendar/holidays.js";

function getTintClassForNow() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 9) return "tint-morning";
  if (hour >= 9 && hour < 17) return "tint-day";
  if (hour >= 17 && hour < 21) return "tint-evening";
  return "tint-night";
}

function initStars() {
  const stars = document.getElementById("stars");
  if (!stars || stars.childElementCount > 0) return;

  const frag = document.createDocumentFragment();
  for (let i = 0; i < 90; i++) {
    const star = document.createElement("i");
    star.style.left = `${(Math.random() * 100).toFixed(1)}%`;
    star.style.top = `${(Math.random() * 72).toFixed(1)}%`;
    // Static per-star brightness instead of a twinkle animation: a
    // continuously animating full-screen starfield forces every glass panel's
    // backdrop-filter to re-blur the whole screen each frame (pinned the Pi
    // GPU process at ~1 core 24/7). Varied opacity keeps the field lively.
    star.style.opacity = (0.2 + Math.random() * 0.7).toFixed(2);
    frag.appendChild(star);
  }
  stars.appendChild(frag);
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

async function checkHoliday() {
  const holidays = await fetchHolidaysForYear(new Date().getFullYear());
  const todayStr = new Date().toDateString();
  const isHoliday = holidays.some(h => new Date(h.start).toDateString() === todayStr);
  document.body.classList.toggle("is-holiday", isHoliday);
}

export function initBackground() {
  initStars();
  updateTint();
  setInterval(updateTint, 10 * 60 * 1000);
  void checkHoliday();
  setInterval(checkHoliday, 24 * 60 * 60 * 1000);
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
}
