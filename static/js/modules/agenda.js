import { addDays, sameDay, formatDate, formatTime } from "../helpers/dates.js";
import { MEAL_PREFIX, EVENT_ICONS } from "../config/config.js";

export function renderAgenda(events) {
  const now = new Date();

  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowEnd = addDays(windowStart, 7);

  const weeklyEl = document.getElementById("weekly-list");
  const mealEl = document.getElementById("meal-list"); // not in HTML yet, but we can add later
  const todayEl = document.getElementById("today-list");
  const todayDateEl = document.getElementById("today-date");
  const weekRangeEl = document.getElementById("week-range");

  if (!weeklyEl || !todayEl || !todayDateEl || !weekRangeEl) return;

  weeklyEl.innerHTML = "";
  if (mealEl) mealEl.innerHTML = "";
  todayEl.innerHTML = "";

  weekRangeEl.textContent = `${formatDate(windowStart)} – ${formatDate(windowEnd)}`;

  const windowEvents = events.filter(e => e.start >= windowStart && e.start < windowEnd);
  windowEvents.sort((a, b) => a.start - b.start);

  const mealsByDay = {};

  windowEvents.forEach(evt => {
    const dayName = evt.start.toLocaleDateString(undefined, { weekday: "short" });
    const summaryUpper = evt.summary.toUpperCase();

    if (summaryUpper.startsWith(MEAL_PREFIX)) {
      const mealText = evt.summary.replace(/MEAL:\s*/i, "");
      if (!mealsByDay[dayName]) {
        mealsByDay[dayName] = [];
      }
      mealsByDay[dayName].push(mealText);
      return;
    }

    const li = document.createElement("li");
    li.className = "agenda-item";

    const title = document.createElement("span");
    title.className = "agenda-title";

    const lower = evt.summary.toLowerCase();
    let icon = "";

    for (const key in EVENT_ICONS) {
      if (lower.includes(key)) {
        icon = EVENT_ICONS[key] + " ";
        break;
      }
    }

    const timeStr = formatTime(evt.start);
    title.textContent = `${icon}${dayName} ${timeStr} — ${evt.summary}`;

    li.appendChild(title);
    weeklyEl.appendChild(li);
  });

  if (mealEl) {
    Object.keys(mealsByDay).forEach(day => {
      mealsByDay[day].forEach(meal => {
        const li = document.createElement("li");
        li.className = "meal-item";

        const icon = document.createElement("span");
        icon.className = "meal-icon";
        icon.textContent = "🍽️";

        const text = document.createElement("span");
        text.className = "meal-text";
        text.textContent = `${day}: ${meal}`;

        li.appendChild(icon);
        li.appendChild(text);
        mealEl.appendChild(li);
      });
    });
  }

  todayDateEl.textContent = formatDate(now);

  const todayEvents = events.filter(e => sameDay(e.start, now));
  todayEvents.sort((a, b) => a.start - b.start);

  todayEvents.forEach(evt => {
    const li = document.createElement("li");
    li.className = "agenda-item";

    const time = document.createElement("span");
    time.className = "agenda-time";
    time.textContent = formatTime(evt.start);

    const title = document.createElement("span");
    title.className = "agenda-title";

    const lower = evt.summary.toLowerCase();
    let icon = "";

    for (const key in EVENT_ICONS) {
      if (lower.includes(key)) {
        icon = EVENT_ICONS[key] + " ";
        break;
      }
    }

    title.textContent = `${icon}${evt.summary}`;

    li.appendChild(time);
    li.appendChild(title);
    todayEl.appendChild(li);
  });
}
