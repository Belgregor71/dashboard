// calendar.js
import { format } from "../helpers/dates.js";
import { emit, on } from "../core/eventBus.js";

const CAL_URL = "/api/calendar/all";
const MEAL_PREFIX = /^Meal:\s*/;
const DEFAULT_CATEGORY = {
  id: "personal",
  label: "Personal",
  icon: "🌿",
  accent: "#38BDF8",
  bg: "rgba(56, 189, 248, 0.12)",
  text: "#F8FAFC"
};

const EVENT_CATEGORIES = [
  {
    id: "work",
    label: "Work",
    icon: "💼",
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
      "zoom",
      "workshop"
    ],
    prefixes: ["work", "meeting"],
    tags: ["work", "office"]
  },
  {
    id: "family",
    label: "Family",
    icon: "👨‍👩‍👧‍👦",
    accent: "#60A5FA",
    bg: "rgba(96, 165, 250, 0.12)",
    keywords: [
      "family",
      "school",
      "pickup",
      "drop off",
      "kids",
      "child",
      "parent",
      "mum",
      "dad",
      "anniversary"
    ],
    prefixes: ["family", "school"],
    tags: ["family", "kids"]
  },
  {
    id: "personal",
    label: "Personal",
    icon: "🌿",
    accent: "#38BDF8",
    bg: "rgba(56, 189, 248, 0.12)",
    keywords: [
      "personal",
      "errand",
      "errands",
      "shopping",
      "groceries",
      "self care",
      "me time",
      "appointment"
    ],
    prefixes: ["personal"],
    tags: ["personal"]
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
      "check-in",
      "hotel",
      "trip"
    ],
    prefixes: ["travel", "flight", "airport"],
    sources: ["tripit"],
    tags: ["travel"]
  },
  {
    id: "birthday",
    label: "Birthday",
    icon: "🎂",
    accent: "#FF5DA2",
    bg: "rgba(255, 93, 162, 0.12)",
    keywords: ["birthday", "bday", "party"],
    prefixes: ["birthday", "bday"],
    tags: ["birthday"]
  },
  {
    id: "bill",
    label: "Bill",
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
    prefixes: ["bill", "payment", "invoice"],
    tags: ["bill", "bills"]
  },
  {
    id: "health",
    label: "Health",
    icon: "🩺",
    accent: "#FB7185",
    bg: "rgba(251, 113, 133, 0.12)",
    keywords: [
      "doctor",
      "gp",
      "dentist",
      "appointment",
      "physio",
      "specialist",
      "clinic",
      "health",
      "therapy",
      "vaccination"
    ],
    prefixes: ["appt", "appointment", "doctor", "dentist"],
    tags: ["health", "medical"]
  },
  {
    id: "home",
    label: "Home",
    icon: "🏡",
    accent: "#94A3B8",
    bg: "rgba(148, 163, 184, 0.12)",
    keywords: [
      "maintenance",
      "plumber",
      "electrician",
      "service",
      "repair",
      "inspection",
      "cleaner",
      "house"
    ],
    prefixes: ["home", "maintenance", "repair"],
    tags: ["home", "house"]
  }
];

const SOURCE_CATEGORY_MAP = {
  tripit: "travel"
};

const AGENDA_SECTION_LIMIT = 3;
const AGENDA_EVENT_LIMIT = 3;
const agendaState = {
  filterCategoryId: null,
  focusIndex: 0,
  dateOffsetDays: 0,
  explicitDate: null
};
let agendaEventsCache = [];
let agendaFocusTargets = [];

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
  const displayTitle = (title?.displayTitle ?? rawTitle) || "(Untitled)";
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

function resolveCategoryById(categoryId) {
  if (!categoryId) return null;
  return EVENT_CATEGORIES.find(category => category.id === categoryId) || null;
}

function extractEventTags(event) {
  const candidates = [
    event?.category,
    event?.tag,
    event?.tags,
    event?.labels,
    event?.label,
    event?.haTags,
    event?.intent,
    event?.categories
  ];

  const tags = [];
  candidates.forEach(candidate => {
    if (!candidate) return;
    if (Array.isArray(candidate)) {
      candidate.forEach(value => {
        if (value) tags.push(String(value));
      });
      return;
    }
    if (typeof candidate === "string") {
      tags.push(candidate);
      return;
    }
    if (typeof candidate === "object" && candidate.name) {
      tags.push(String(candidate.name));
    }
  });

  return tags;
}

function resolveEventCategory(event) {
  const rawTitle = event.title || "";
  const normalizedTitle = normalizeEventText(rawTitle);
  const normalizedDescription = normalizeEventText(event.description || "");
  const sourceKey = normalizeEventText(event.source || "");

  if (sourceKey && SOURCE_CATEGORY_MAP[sourceKey]) {
    const mapped = resolveCategoryById(SOURCE_CATEGORY_MAP[sourceKey]);
    if (mapped) {
      return { category: mapped, displayTitle: rawTitle || "(Untitled)" };
    }
  }

  const tags = extractEventTags(event);
  if (tags.length) {
    const normalizedTags = normalizeEventText(tags.join(" "));
    for (const category of EVENT_CATEGORIES) {
      const tagList = category.tags || [category.id, category.label];
      if (matchKeywords(normalizedTags, tagList)) {
        return { category, displayTitle: rawTitle || "(Untitled)" };
      }
    }
  }

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

function updateAgendaView() {
  renderAgenda(agendaEventsCache);
}

function setAgendaEvents(events) {
  agendaEventsCache = Array.isArray(events) ? events : [];
  updateAgendaView();
}

function resetAgendaState() {
  agendaState.filterCategoryId = null;
  agendaState.focusIndex = 0;
  agendaState.dateOffsetDays = 0;
  agendaState.explicitDate = null;
}

function resolveAgendaCategoryId(rawValue) {
  if (!rawValue) return null;
  const normalized = normalizeEventText(String(rawValue));
  if (!normalized) return null;
  const directMatch = EVENT_CATEGORIES.find(
    category =>
      normalizeEventText(category.id) === normalized ||
      normalizeEventText(category.label) === normalized
  );
  return directMatch?.id || null;
}

function setAgendaFilter(filterValue) {
  const resolved = resolveAgendaCategoryId(filterValue);
  agendaState.filterCategoryId = resolved;
  agendaState.focusIndex = 0;
  updateAgendaView();
}

function setAgendaDate({ date, offsetDays } = {}) {
  if (typeof offsetDays === "number" && Number.isFinite(offsetDays)) {
    agendaState.dateOffsetDays = offsetDays;
    agendaState.explicitDate = null;
    agendaState.focusIndex = 0;
    updateAgendaView();
    return;
  }

  if (typeof date === "string") {
    const normalized = normalizeEventText(date);
    if (normalized === "today") {
      agendaState.dateOffsetDays = 0;
      agendaState.explicitDate = null;
    } else if (normalized === "tomorrow") {
      agendaState.dateOffsetDays = 1;
      agendaState.explicitDate = null;
    } else {
      const parsed = new Date(date);
      if (!Number.isNaN(parsed.getTime())) {
        agendaState.explicitDate = parsed;
      }
    }
    agendaState.focusIndex = 0;
    updateAgendaView();
    return;
  }
}

function focusNextAgendaEvent() {
  if (!agendaFocusTargets.length) return;
  agendaState.focusIndex = (agendaState.focusIndex + 1) % agendaFocusTargets.length;
  agendaFocusTargets.forEach(target =>
    target.classList.remove("agenda-event--focused")
  );
  const nextTarget = agendaFocusTargets[agendaState.focusIndex];
  if (nextTarget) {
    nextTarget.classList.add("agenda-event--focused");
  }
}

on("agenda:reset", () => {
  resetAgendaState();
  updateAgendaView();
});
on("agenda:filter", ({ category }) => {
  setAgendaFilter(category);
});
on("agenda:date", ({ date, offsetDays } = {}) => {
  setAgendaDate({ date, offsetDays });
});
on("agenda:focus-next", () => {
  focusNextAgendaEvent();
});

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
    setAgendaEvents(expanded);
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
  setAgendaEvents([]);
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
  grid.style.setProperty("--calendar-rows", String(totalCells / 7));
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
  const titleEl = document.getElementById("agenda-title");
  const todayLabel = document.getElementById("agenda-today-label");

  if (!container) {
    console.warn("Calendar UI missing #agenda-list");
    return;
  }

  const today = new Date();
  const selectedDate = agendaState.explicitDate
    ? new Date(agendaState.explicitDate)
    : new Date(today);
  if (!agendaState.explicitDate) {
    selectedDate.setDate(selectedDate.getDate() + agendaState.dateOffsetDays);
  }
  const isTodaySelected = selectedDate.toDateString() === today.toDateString();

  if (titleEl) {
    titleEl.textContent = isTodaySelected ? "Today" : format.date(selectedDate);
  }
  if (todayLabel) {
    todayLabel.textContent = format.dayName(selectedDate);
  }

  container.innerHTML = "";
  agendaFocusTargets = [];

  const dayEvents = (events || [])
    .filter(ev => ev.start && ev.start.toDateString() === selectedDate.toDateString())
    .filter(ev => {
      if (!agendaState.filterCategoryId) return true;
      return ev.category?.id === agendaState.filterCategoryId;
    })
    .sort((a, b) => a.start - b.start);

  if (!dayEvents.length) {
    const empty = document.createElement("div");
    empty.className = "agenda-empty";
    empty.textContent = "No events scheduled";
    container.appendChild(empty);
    return;
  }

  const groupMap = new Map();
  dayEvents.forEach(ev => {
    const category = ev.category || DEFAULT_CATEGORY;
    const categoryId = category.id || DEFAULT_CATEGORY.id;
    if (!groupMap.has(categoryId)) {
      groupMap.set(categoryId, {
        category,
        events: [],
        earliest: ev.start ? ev.start.getTime() : Number.POSITIVE_INFINITY
      });
    }
    const group = groupMap.get(categoryId);
    group.events.push(ev);
    if (ev.start) {
      group.earliest = Math.min(group.earliest, ev.start.getTime());
    }
  });

  const groups = Array.from(groupMap.values())
    .map(group => ({
      ...group,
      events: group.events.slice().sort((a, b) => a.start - b.start)
    }))
    .sort((a, b) => a.earliest - b.earliest)
    .slice(0, AGENDA_SECTION_LIMIT);

  groups.forEach(group => {
    const section = document.createElement("div");
    section.className = "agenda-section";

    const header = document.createElement("div");
    header.className = "agenda-section-header";

    const sectionTitle = document.createElement("div");
    sectionTitle.className = "agenda-section-title";
    sectionTitle.textContent = `${group.category.icon} ${group.category.label}`;
    header.appendChild(sectionTitle);

    const sectionCount = document.createElement("div");
    sectionCount.className = "agenda-section-count";
    sectionCount.textContent = `${group.events.length} event${group.events.length === 1 ? "" : "s"}`;
    header.appendChild(sectionCount);

    section.appendChild(header);

    const list = document.createElement("div");
    list.className = "agenda-section-list";

    group.events.slice(0, AGENDA_EVENT_LIMIT).forEach(ev => {
      const row = document.createElement("div");
      row.className = "agenda-event";
      applyEventCategoryStyles(row, group.category);

      const icon = document.createElement("span");
      icon.className = "agenda-event-icon";
      icon.textContent = group.category.icon;

      const title = document.createElement("span");
      title.className = "agenda-event-title";
      title.textContent = ev.displayTitle || ev.title || "(Untitled)";

      const time = document.createElement("span");
      time.className = "agenda-event-time";
      if (isAllDay(ev)) {
        time.textContent = "All day";
      } else if (ev.end && ev.end.getTime() !== ev.start.getTime()) {
        time.textContent = `${format.time(ev.start)} – ${format.time(ev.end)}`;
      } else {
        time.textContent = format.time(ev.start);
      }

      row.appendChild(icon);
      row.appendChild(title);
      row.appendChild(time);
      list.appendChild(row);
      agendaFocusTargets.push(row);
    });

    if (group.events.length > AGENDA_EVENT_LIMIT) {
      const overflow = document.createElement("div");
      overflow.className = "agenda-overflow";
      overflow.textContent = `+${group.events.length - AGENDA_EVENT_LIMIT} more in ${group.category.label}`;
      list.appendChild(overflow);
    }

    section.appendChild(list);
    container.appendChild(section);
  });

  agendaFocusTargets.forEach(target =>
    target.classList.remove("agenda-event--focused")
  );
  if (agendaFocusTargets.length) {
    agendaState.focusIndex = Math.min(agendaState.focusIndex, agendaFocusTargets.length - 1);
    const active = agendaFocusTargets[agendaState.focusIndex];
    if (active) active.classList.add("agenda-event--focused");
  }
}
