// calendar.js
import { format } from "../helpers/dates.js";
import { emit } from "../core/eventBus.js";

const CAL_URL = "/api/calendar/all";
const MEAL_PREFIX = /^Meal:\s*/;
const DEFAULT_CATEGORY = {
  id: "default",
  label: "Other",
  icon: "📌",
  accent: "#64748B",
  bg: "rgba(100, 116, 139, 0.1)",
  text: "#F8FAFC"
};

const EVENT_CATEGORIES = [
  {
    id: "birthday",
    label: "Birthday",
    icon: "🎂",
    accent: "#FF5DA2",
    bg: "rgba(255, 93, 162, 0.12)",
    keywords: ["birthday", "bday", "party"],
    prefixes: ["birthday", "bday"]
  },
  {
    id: "bills",
    label: "Bills",
    icon: "💵",
    accent: "#22C55E",
    bg: "rgba(34, 197, 94, 0.12)",
    keywords: [
      "bill",
      "invoice",
      "payment",
      "rent",
      "rates",
      "rego",
      "due",
      "electric",
      "gas",
      "water",
      "telstra",
      "optus",
      "vodafone",
      "internet"
    ],
    prefixes: ["bill", "payment", "invoice"]
  },
  {
    id: "appointments",
    label: "Appointments",
    icon: "🩺",
    accent: "#38BDF8",
    bg: "rgba(56, 189, 248, 0.12)",
    keywords: [
      "doctor",
      "gp",
      "dentist",
      "appointment",
      "physio",
      "specialist",
      "clinic"
    ],
    prefixes: ["appt", "appointment", "doctor", "dentist"]
  },
  {
    id: "travel",
    label: "Travel",
    icon: "✈️",
    accent: "#A78BFA",
    bg: "rgba(167, 139, 250, 0.12)",
    keywords: [
      "flight",
      "airport",
      "depart",
      "arrive",
      "airline",
      "booking",
      "check in",
      "check-in"
    ],
    prefixes: ["travel", "flight", "airport"]
  },
  {
    id: "work",
    label: "Work",
    icon: "📅",
    accent: "#F59E0B",
    bg: "rgba(245, 158, 11, 0.12)",
    keywords: [
      "meeting",
      "1:1",
      "standup",
      "sync",
      "review",
      "call",
      "teams",
      "zoom"
    ],
    prefixes: ["work", "meeting"]
  },
  {
    id: "school",
    label: "School",
    icon: "🏫",
    accent: "#60A5FA",
    bg: "rgba(96, 165, 250, 0.12)",
    keywords: [
      "school",
      "assembly",
      "excursion",
      "pickup",
      "drop off",
      "term",
      "uniform"
    ],
    prefixes: ["school"]
  },
  {
    id: "fitness",
    label: "Fitness",
    icon: "🏋️",
    accent: "#FB7185",
    bg: "rgba(251, 113, 133, 0.12)",
    keywords: ["gym", "run", "training", "pilates", "yoga", "workout"],
    prefixes: ["fitness", "gym"]
  },
  {
    id: "reminders",
    label: "Reminders",
    icon: "✅",
    accent: "#EAB308",
    bg: "rgba(234, 179, 8, 0.12)",
    keywords: ["todo", "reminder", "task", "buy", "get", "pickup"],
    prefixes: ["todo", "reminder", "task"]
  },
  {
    id: "home",
    label: "Home",
    icon: "🛠️",
    accent: "#94A3B8",
    bg: "rgba(148, 163, 184, 0.12)",
    keywords: [
      "maintenance",
      "plumber",
      "electrician",
      "service",
      "repair",
      "inspection",
      "cleaner"
    ],
    prefixes: ["home", "maintenance", "repair"]
  },
  {
    id: "social",
    label: "Social",
    icon: "🎉",
    accent: "#F472B6",
    bg: "rgba(244, 114, 182, 0.12)",
    keywords: [
      "dinner",
      "drinks",
      "bbq",
      "party",
      "catch up",
      "concert"
    ],
    prefixes: ["social", "event"]
  }
];

function loadMealLottie(container) {
  if (!container || !window.lottie) return;
  if (container._lottieInstance) return container._lottieInstance;

  const anim = window.lottie.loadAnimation({
    container,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "/icons/Food.lottie"
  });

  container._lottieInstance = anim;
  return anim;
}

function appendEventTitle(container, title) {
  const rawTitle = title?.rawTitle ?? title?.title ?? title ?? "";
  const displayTitle = title?.displayTitle ?? rawTitle || "(Untitled)";
  if (MEAL_PREFIX.test(rawTitle)) {
    const mealTitle = displayTitle.replace(MEAL_PREFIX, "").trim();
    const icon = document.createElement("span");
    icon.className = "meal-lottie";
    container.appendChild(icon);
    loadMealLottie(icon);

    container.append(
      document.createTextNode(` ${mealTitle || "Meal"}`.trimStart())
    );
    return;
  }

  const category = title?.category ?? DEFAULT_CATEGORY;
  const icon = document.createElement("span");
  icon.className = "event-icon";
  icon.textContent = category.icon || DEFAULT_CATEGORY.icon;
  container.appendChild(icon);
  container.append(document.createTextNode(displayTitle || "(Untitled)"));
}

function normalizeEventText(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPrefixRegex(prefixes = []) {
  if (!prefixes.length) return null;
  const pattern = prefixes.map(prefix => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`^\\s*(?:${pattern})\\s*[:\\-]\\s*`, "i");
}

function matchKeywords(text, keywords = []) {
  if (!text || !keywords.length) return false;
  return keywords.some(keyword => {
    const normalizedKeyword = normalizeEventText(keyword);
    return normalizedKeyword ? text.includes(normalizedKeyword) : false;
  });
}

function resolveEventCategory(event) {
  const rawTitle = event.title || "";
  const normalizedTitle = normalizeEventText(rawTitle);
  const normalizedDescription = normalizeEventText(event.description || "");

  for (const category of EVENT_CATEGORIES) {
    const prefixRegex = buildPrefixRegex(category.prefixes);
    if (prefixRegex && prefixRegex.test(rawTitle)) {
      const strippedTitle = rawTitle.replace(prefixRegex, "").trim();
      return {
        category,
        displayTitle: strippedTitle || "(Untitled)"
      };
    }
  }

  for (const category of EVENT_CATEGORIES) {
    if (matchKeywords(normalizedTitle, category.keywords)) {
      return { category, displayTitle: rawTitle || "(Untitled)" };
    }
  }

  for (const category of EVENT_CATEGORIES) {
    if (matchKeywords(normalizedDescription, category.keywords)) {
      return { category, displayTitle: rawTitle || "(Untitled)" };
    }
  }

  return { category: DEFAULT_CATEGORY, displayTitle: rawTitle || "(Untitled)" };
}

function applyEventCategoryStyles(element, category, variant) {
  if (!element) return;
  element.classList.add("event-item");
  if (variant) {
    element.classList.add(`event-item--${variant}`);
  }
  const resolved = category || DEFAULT_CATEGORY;
  element.style.setProperty("--event-accent", resolved.accent);
  element.style.setProperty("--event-bg", resolved.bg);
  element.style.setProperty("--event-text", resolved.text || "inherit");
}

/* ------------------------------------------------------------------
   MAIN REFRESH FUNCTION
-------------------------------------------------------------------*/

export async function refreshCalendar() {
  try {
    const res = await fetch(CAL_URL);

    // If backend fails, don’t try to parse/render like normal
    if (!res.ok) {
      console.warn(`Calendar HTTP ${res.status}`);
      safeRenderEmpty();
      return;
    }

    const data = await res.json();

    // Backend might return { error: "..." } instead of an array
    if (!Array.isArray(data)) {
      console.warn("Calendar returned non-array:", data);
      safeRenderEmpty();
      return;
    }

    // Normalize dates to LOCAL TIME
    const normalized = normalizeEvents(data);

    const expanded = expandMultiDay(normalized);
    const todayEvents = getTodayEvents(expanded);
    const weekEvents = getNext7DaysEvents(expanded);

    renderToday(todayEvents);
    renderWeek(weekEvents);
    renderMonth(expanded);
    renderAgenda(expanded);
  } catch (err) {
    console.error("Calendar error:", err);
    safeRenderEmpty();
  }
}

/* ------------------------------------------------------------------
   SAFE EMPTY RENDER (prevents white screen if containers missing)
-------------------------------------------------------------------*/

function safeRenderEmpty() {
  renderToday([]);
  renderWeek(getNext7DaysEvents([]));
  renderMonth([]);
  renderAgenda([]);
}

/* ------------------------------------------------------------------
   NORMALIZE EVENT DATES TO LOCAL TIME
-------------------------------------------------------------------*/

function toLocal(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeEvents(events) {
  return events
    .map(ev => {
      const start = toLocal(ev.start);
      const end = toLocal(ev.end);

      // Skip events with invalid dates
      if (!start) return null;

      const categoryData = resolveEventCategory(ev);

      return {
        ...ev,
        start,
        end: end || start, // fallback so multi-day logic doesn’t explode
        category: categoryData.category,
        displayTitle: categoryData.displayTitle,
        rawTitle: ev.title || ""
      };
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------
   EVENT NORMALISATION
-------------------------------------------------------------------*/

function isAllDay(ev) {
  return (
    ev.allDay ||
    (ev.start &&
      ev.end &&
      ev.start.getHours() === 0 &&
      ev.end.getHours() === 0)
  );
}

function expandMultiDay(events) {
  const expanded = [];

  for (const ev of events) {
    const start = new Date(ev.start);
    const end = new Date(ev.end);

    // If end is invalid, treat as single day
    if (Number.isNaN(end.getTime())) {
      expanded.push(ev);
      continue;
    }

    let adjustedEnd = end;

    if (
      isAllDay(ev) &&
      end > start &&
      end.getHours() === 0 &&
      end.getMinutes() === 0 &&
      end.getSeconds() === 0 &&
      end.getMilliseconds() === 0
    ) {
      adjustedEnd = new Date(end);
      adjustedEnd.setDate(adjustedEnd.getDate() - 1);
      if (adjustedEnd < start) {
        adjustedEnd = start;
      }
    }

    if (start.toDateString() !== adjustedEnd.toDateString()) {
      let d = new Date(start);
      while (d <= adjustedEnd) {
        expanded.push({
          ...ev,
          start: new Date(d),
          end: new Date(d),
          multiDay: true
        });
        d.setDate(d.getDate() + 1);
      }
    } else {
      expanded.push(ev);
    }
  }

  return expanded;
}

/* ------------------------------------------------------------------
   FILTERING
-------------------------------------------------------------------*/

function isToday(date) {
  const now = new Date();
  return date && date.toDateString() === now.toDateString();
}

function getTodayEvents(events) {
  return events.filter(ev => ev.start && isToday(ev.start));
}

function getNext7DaysEvents(events) {
  const today = new Date();
  const days = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }

  return days.map(day => ({
    date: day,
    events: events.filter(
      ev => ev.start && ev.start.toDateString() === day.toDateString()
    )
  }));
}

/* ------------------------------------------------------------------
   RENDER: TODAY PANEL
-------------------------------------------------------------------*/

function renderToday(events) {
  const container = document.getElementById("today-list");
  if (!container) {
    console.warn("Calendar UI missing #today-list");
    return;
  }

  container.innerHTML = "";

  if (!events || events.length === 0) {
    container.innerHTML = `<div class="today-empty">Nothing scheduled</div>`;
    return;
  }

  const allDay = events.filter(isAllDay);
  const timed = events.filter(ev => !isAllDay(ev));

  allDay.forEach(ev => {
    const div = document.createElement("div");
    div.className = "today-all-day";
    applyEventCategoryStyles(div, ev.category, "line");
    appendEventTitle(div, ev);
    container.appendChild(div);
  });

  if (allDay.length && timed.length) {
    container.appendChild(document.createElement("br"));
  }

  timed.forEach(ev => {
    const div = document.createElement("div");
    div.className = "today-event";
    div.append(document.createTextNode(`${format.time(ev.start)} – `));
    applyEventCategoryStyles(div, ev.category, "line");
    appendEventTitle(div, ev);
    container.appendChild(div);
  });
}

/* ------------------------------------------------------------------
   RENDER: WEEK PANEL (with weather icon placeholders)
-------------------------------------------------------------------*/

function renderWeek(days) {
  const container = document.getElementById("weekly-list");
  if (!container) {
    console.warn("Calendar UI missing #weekly-list");
    return;
  }

  container.innerHTML = "";

  (days || []).forEach(({ date, events }, index) => {
    const dayDiv = document.createElement("div");
    dayDiv.className = "week-day-block";

    // Weather icon placeholder for this day
    const iconDiv = document.createElement("div");
    iconDiv.className = "week-weather-icon";
    iconDiv.id = `week-icon-${index}`;
    dayDiv.appendChild(iconDiv);

    const isTodayFlag = isToday(date);
    const dayName = format.dayName(date);

    const header = document.createElement("div");
    header.className = "week-day" + (isTodayFlag ? " week-today" : "");
    header.textContent = dayName;
    dayDiv.appendChild(header);

    if (!events || events.length === 0) {
      const empty = document.createElement("div");
      empty.className = "week-empty";
      empty.textContent = "No events";
      dayDiv.appendChild(empty);
    } else {
      const allDay = events.filter(isAllDay);
      const timed = events.filter(ev => !isAllDay(ev)).sort(
        (a, b) => a.start - b.start
      );
      const maxEvents = 2;
      const entries = [...allDay, ...timed].slice(0, maxEvents);

      entries.forEach(ev => {
        const div = document.createElement("div");
        if (isAllDay(ev)) {
          div.className = "week-all-day";
          applyEventCategoryStyles(div, ev.category, "line");
          appendEventTitle(div, ev);
        } else {
          div.className = "week-event";
          div.append(document.createTextNode(`${format.time(ev.start)} – `));
          applyEventCategoryStyles(div, ev.category, "line");
          appendEventTitle(div, ev);
        }

        dayDiv.appendChild(div);
      });
    }

    container.appendChild(dayDiv);
  });

  emit("calendar:weekRendered");
}

/* ------------------------------------------------------------------
   RENDER: MONTH VIEW (CALENDAR PAGE)
-------------------------------------------------------------------*/

function renderMonth(events) {
  const grid = document.getElementById("calendar-month-grid");
  const title = document.getElementById("calendar-month-title");
  const todayLabel = document.getElementById("calendar-today-label");

  if (!grid || !title) {
    if (!grid) console.warn("Calendar UI missing #calendar-month-grid");
    if (!title) console.warn("Calendar UI missing #calendar-month-title");
    return;
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  title.textContent = today.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric"
  });

  if (todayLabel) {
    todayLabel.textContent = format.date(today);
  }

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startIndex = firstDay.getDay();
  const totalCells = Math.ceil((startIndex + lastDay.getDate()) / 7) * 7;

  const eventsByDay = new Map();

  (events || []).forEach(ev => {
    if (!ev.start) return;
    const start = new Date(ev.start);
    if (start.getFullYear() !== year || start.getMonth() !== month) return;
    const key = `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`;
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key).push(ev);
  });

  grid.innerHTML = "";

  for (let i = 0; i < totalCells; i++) {
    const dayNumber = i - startIndex + 1;
    const cell = document.createElement("div");
    cell.className = "calendar-day";

    if (dayNumber < 1 || dayNumber > lastDay.getDate()) {
      cell.classList.add("calendar-day--outside");
      grid.appendChild(cell);
      continue;
    }

    const cellDate = new Date(year, month, dayNumber);
    const key = `${year}-${month}-${dayNumber}`;
    const dayEvents = (eventsByDay.get(key) || []).slice().sort(
      (a, b) => a.start - b.start
    );

    if (isToday(cellDate)) {
      cell.classList.add("calendar-today");
    }

    const dateEl = document.createElement("div");
    dateEl.className = "calendar-date";
    const dateBadge = document.createElement("span");
    dateBadge.textContent = dayNumber;
    dateEl.appendChild(dateBadge);
    cell.appendChild(dateEl);

    const maxEvents = 2;
    dayEvents.slice(0, maxEvents).forEach(ev => {
      const eventEl = document.createElement("div");
      eventEl.className = "calendar-event";
      applyEventCategoryStyles(eventEl, ev.category, "pill");
      if (isAllDay(ev)) {
        appendEventTitle(eventEl, ev);
      } else {
        eventEl.append(document.createTextNode(`${format.time(ev.start)} `));
        appendEventTitle(eventEl, ev);
      }
      cell.appendChild(eventEl);
    });

    if (dayEvents.length > maxEvents) {
      const moreEl = document.createElement("div");
      moreEl.className = "calendar-event calendar-event--more";
      moreEl.textContent = `+${dayEvents.length - maxEvents} more`;
      cell.appendChild(moreEl);
    }

    grid.appendChild(cell);
  }
}

/* ------------------------------------------------------------------
   RENDER: AGENDA VIEW
-------------------------------------------------------------------*/

function renderAgenda(events) {
  const container = document.getElementById("agenda-list");
  const todayLabel = document.getElementById("agenda-today-label");

  if (!container) {
    console.warn("Calendar UI missing #agenda-list");
    return;
  }

  const today = new Date();
  if (todayLabel) {
    todayLabel.textContent = format.date(today);
  }

  const daysToShow = 5;
  const dayBuckets = [];

  for (let i = 0; i < daysToShow; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : format.dayName(date);
    dayBuckets.push({ date, label, events: [] });
  }

  (events || []).forEach(ev => {
    if (!ev.start) return;
    const evDate = new Date(ev.start);
    const bucket = dayBuckets.find(
      item => item.date.toDateString() === evDate.toDateString()
    );
    if (bucket) {
      bucket.events.push(ev);
    }
  });

  container.innerHTML = "";

  dayBuckets.forEach(day => {
    const dayWrap = document.createElement("div");
    dayWrap.className = "agenda-day";

    const title = document.createElement("div");
    title.className = "agenda-day-title";
    title.textContent = `${day.label} · ${format.date(day.date)}`;
    dayWrap.appendChild(title);

    const dayEvents = day.events
      .slice()
      .sort((a, b) => a.start - b.start);

    if (dayEvents.length === 0) {
      const empty = document.createElement("div");
      empty.className = "agenda-card";
      empty.textContent = "No events scheduled";
      dayWrap.appendChild(empty);
    } else {
      dayEvents.forEach(ev => {
        const card = document.createElement("div");
        card.className = "agenda-card";
        applyEventCategoryStyles(card, ev.category, "card");

        const main = document.createElement("div");
        main.className = "agenda-card-main";

        const time = document.createElement("div");
        time.className = "agenda-time";
        time.textContent = isAllDay(ev)
          ? "All day"
          : `${format.time(ev.start)} – ${format.time(ev.end || ev.start)}`;
        main.appendChild(time);

        const titleEl = document.createElement("div");
        titleEl.className = "agenda-title";
        appendEventTitle(titleEl, ev);
        main.appendChild(titleEl);

        if (ev.location) {
          const location = document.createElement("div");
          location.className = "agenda-location";
          location.textContent = ev.location;
          main.appendChild(location);
        }

        const meta = document.createElement("div");
        meta.className = "agenda-card-meta";
        meta.textContent = ev.allDay ? "All day" : "Scheduled";

        card.appendChild(main);
        card.appendChild(meta);
        dayWrap.appendChild(card);
      });
    }

    container.appendChild(dayWrap);
  });
}
