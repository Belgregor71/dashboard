// calendar.js
import { format } from "../helpers/dates.js";
import { emit, on } from "../core/eventBus.js";
import { initDetailsPopover } from "../services/calendar/detailsPopover.js";
import { fetchHolidaysForMonthContext } from "../services/calendar/holidays.js";
import { registerCalendarCommandHandlers } from "../services/calendar/commands.js";
import { computeTravelMoments } from "../services/momentsEngine.js";

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

const TIMELINE_BUCKETS = ["Today", "Tomorrow", "This Week", "Later"];
const BIN_CATEGORY = {
  id: "bins",
  label: "Bins",
  icon: "🗑️",
  accent: "#94A3B8",
  bg: "rgba(148, 163, 184, 0.12)",
  text: "#F8FAFC"
};
let binState = null;
const calendarState = {
  focusedEventId: null,
  eventsCache: [],
  selectedDate: new Date(),
  lastInteractionSource: "ui",
  birthdaysOnly: false,
  detailsPopover: null
};
const CALENDAR_DEBUG =
  typeof window !== "undefined" &&
  (window.__ENV__?.CALENDAR_DEBUG === "1" || window.__DASH_CONFIG__?.calendar?.debug === true);

function calendarDebug(...args) {
  if (!CALENDAR_DEBUG) return;
  console.debug("[calendar]", ...args);
}

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

function scrollTimelineToGroup(label) {
  const container = document.getElementById("timeline-list");
  if (!container) return;
  const groups = container.querySelectorAll(".timeline-group-title");
  const target = Array.from(groups).find(el => el.textContent === label);
  target?.scrollIntoView({ block: "start" });
}

function goToToday() {
  calendarState.lastInteractionSource = "voice";
  calendarDebug("goToToday");
  scrollTimelineToGroup("Today");
}

function goToLater() {
  calendarState.lastInteractionSource = "voice";
  calendarDebug("goToLater");
  scrollTimelineToGroup("Later");
}

function toggleBirthdaysOnly() {
  calendarState.birthdaysOnly = !calendarState.birthdaysOnly;
  calendarState.lastInteractionSource = "voice";
  calendarDebug("birthdaysOnly", calendarState.birthdaysOnly);
  void refreshCalendar();
}

registerCalendarCommandHandlers({
  // No month grid in the unified Timeline — "next/previous month" instead
  // jumps between the Today section and the Later (everything 7+ days out) section.
  nextMonth: () => goToLater(),
  previousMonth: () => goToToday(),
  goToday: () => goToToday(),
  showAgenda: () => goToToday(),
  showBirthdays: () => toggleBirthdaysOnly(),
  showDetails: () => openFocusedDetails(),
  closeDetails: () => closeDetailsPopover(),
  detailsForNextEvent: () => openFocusedDetails({ forceNext: true })
});

on("calendar:next-month", () => goToLater());
on("calendar:previous-month", () => goToToday());
on("calendar:go-today", () => goToToday());
on("calendar:show-details", () => openFocusedDetails());
on("calendar:close-details", () => closeDetailsPopover());

on("timeline:scroll", ({ label } = {}) => {
  if (label) scrollTimelineToGroup(label);
});

on("bins:updated", data => {
  binState = data?.due ? data : null;
  renderTimeline(applyCalendarFilters(calendarState.eventsCache));
});


/* ------------------------------------------------------------------
   MAIN REFRESH FUNCTION
-------------------------------------------------------------------*/

export async function refreshCalendar() {
  try {
    ensureDetailsPopover();
    const res = await fetch(CAL_URL);

    if (!res.ok) {
      console.warn(`Calendar HTTP ${res.status}`);
      safeRenderEmpty();
      return;
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      console.warn("Calendar returned non-array:", data);
      safeRenderEmpty();
      return;
    }

    const holidays = await fetchHolidaysForMonthContext(calendarState.selectedDate);
    const normalized = normalizeEvents(mergeHolidayEvents(data, holidays));
    calendarState.eventsCache = normalized;
    const expandedAll = expandMultiDay(normalized);
    window.__CAL_EVENTS__ = expandedAll;

    const filtered = applyCalendarFilters(normalized);

    updateFocusedEvent(filtered);
    renderTimeline(filtered);
    emit("calendar:refreshed", { timestamp: Date.now(), count: filtered.length });
  } catch (err) {
    console.error("Calendar error:", err);
    safeRenderEmpty();
  }
}

/* ------------------------------------------------------------------
   SAFE EMPTY RENDER (prevents white screen if containers missing)
-------------------------------------------------------------------*/


function ensureDetailsPopover() {
  if (calendarState.detailsPopover) return;
  const root = document.getElementById("timeline-view");
  calendarState.detailsPopover = initDetailsPopover(root);
}

function mergeHolidayEvents(events, holidays) {
  const merged = [...(Array.isArray(events) ? events : [])];
  const seen = new Set(
    merged.map(ev => `${String(ev.title || "").toLowerCase()}|${String(ev.start || "")}|${String(ev.source || "")}`)
  );

  (holidays || []).forEach(holiday => {
    const key = `${String(holiday.title || "").toLowerCase()}|${holiday.start}|holidays`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(holiday);
  });
  return merged;
}

function isBirthdayEvent(ev) {
  const text = `${ev?.title || ""} ${ev?.displayTitle || ""}`.toLowerCase();
  return ev?.category?.id === "birthday" || text.includes("birthday") || (ev?.tags || []).includes("birthday");
}

function applyCalendarFilters(events) {
  if (!calendarState.birthdaysOnly) return events;
  return (events || []).filter(isBirthdayEvent);
}

function getNextUpcomingEvent(events, options = {}) {
  const now = options.fromDate instanceof Date ? options.fromDate : new Date();
  const onlyBirthdays = options.onlyBirthdays === true;
  const candidates = (events || [])
    .filter(ev => ev?.start)
    .filter(ev => !onlyBirthdays || isBirthdayEvent(ev))
    .filter(ev => ev.end >= now)
    .sort((a, b) => a.start - b.start);
  return candidates[0] || null;
}

function updateFocusedEvent(events) {
  const activeEvents = Array.isArray(events) ? events : [];
  if (calendarState.focusedEventId) {
    const existing = activeEvents.find(ev => ev.id === calendarState.focusedEventId);
    if (existing) return;
  }
  const next = getNextUpcomingEvent(activeEvents, {
    fromDate: new Date(),
    onlyBirthdays: calendarState.birthdaysOnly
  });
  calendarState.focusedEventId = next?.id || null;
}

function getFocusedEvent() {
  if (!calendarState.focusedEventId) {
    return getNextUpcomingEvent(calendarState.eventsCache, {
      fromDate: new Date(),
      onlyBirthdays: calendarState.birthdaysOnly
    });
  }
  return calendarState.eventsCache.find(ev => ev.id === calendarState.focusedEventId) || null;
}

function resolveTravelTimeText(_eventObj) {
  const hasHomeBase =
    typeof window !== "undefined" &&
    typeof window.__ENV__?.HOME_BASE === "string" &&
    window.__ENV__.HOME_BASE.trim().length > 0;
  if (!hasHomeBase) return null;
  return null;
}

function openFocusedDetails({ forceNext = false } = {}) {
  ensureDetailsPopover();
  if (!calendarState.detailsPopover) return;
  const focused = forceNext
    ? getNextUpcomingEvent(calendarState.eventsCache, {
      fromDate: new Date(),
      onlyBirthdays: calendarState.birthdaysOnly
    })
    : getFocusedEvent();
  if (!focused) return;
  calendarState.focusedEventId = focused.id;
  calendarState.detailsPopover.openDetails({
    ...focused,
    travelTimeText: resolveTravelTimeText(focused)
  });
}

function closeDetailsPopover() {
  if (!calendarState.detailsPopover) return;
  calendarState.detailsPopover.closeDetails();
}

function safeRenderEmpty() {
  renderTimeline([]);
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
      const stableId =
        ev.id ||
        [ev.source || "calendar", ev.title || "untitled", ev.start || "", ev.end || ""]
          .join("|")
          .toLowerCase();
      const isAllDayEvent = Boolean(
        ev.allDay ||
          (start && end && start.getHours() === 0 && end.getHours() === 0)
      );

      const normalizedEnd = end || start;
      const rangeEnd = new Date(normalizedEnd);
      if (
        isAllDayEvent &&
        rangeEnd > start &&
        rangeEnd.getHours() === 0 &&
        rangeEnd.getMinutes() === 0
      ) {
        rangeEnd.setDate(rangeEnd.getDate() - 1);
      }

      const daySpanDates = [];
      let cursor = new Date(start);
      cursor.setHours(0, 0, 0, 0);
      const endCursor = new Date(rangeEnd);
      endCursor.setHours(0, 0, 0, 0);
      while (cursor <= endCursor) {
        daySpanDates.push(formatYmd(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }

      return {
        ...ev,
        id: stableId,
        start,
        end: normalizedEnd,
        isAllDay: isAllDayEvent,
        startDate: formatYmd(start),
        endDate: formatYmd(endCursor),
        spansMultipleDays: daySpanDates.length > 1,
        daySpanDates,
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

function formatYmd(dateValue) {
  if (!dateValue) return "";
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isAllDay(ev) {
  return Boolean(ev?.isAllDay);
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
      const totalSpanDays = Math.floor((adjustedEnd - start) / (24 * 60 * 60 * 1000)) + 1;
      let index = 0;
      let d = new Date(start);
      while (d <= adjustedEnd) {
        expanded.push({
          ...ev,
          start: new Date(d),
          end: new Date(d),
          multiDay: true,
          spanPosition: index === 0 ? "start" : index === totalSpanDays - 1 ? "end" : "mid"
        });
        index += 1;
        d.setDate(d.getDate() + 1);
      }
    } else {
      expanded.push({
        ...ev,
        spanPosition: "single"
      });
    }
  }

  return expanded;
}

/* ------------------------------------------------------------------
   BIN PSEUDO-EVENTS
-------------------------------------------------------------------*/

function getBinPseudoEvents() {
  if (!binState?.due) return [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (binState.eve) start.setDate(start.getDate() + 1);
  const title = binState.binsText ? `${binState.label} (${binState.binsText})` : binState.label;
  return [{
    id: "bin-reminder",
    title,
    displayTitle: title,
    rawTitle: title,
    category: BIN_CATEGORY,
    start,
    end: start,
    isAllDay: true
  }];
}

/* ------------------------------------------------------------------
   RENDER: UNIFIED TIMELINE
   (replaces the former Today panel, Week-at-a-glance, Calendar month
   grid and Agenda views with one chronological list)
-------------------------------------------------------------------*/

function dayDiff(date) {
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b - a) / 86400000);
}

function bucketLabel(diff) {
  if (diff < 0) return null;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff <= 6) return "This Week";
  return "Later";
}

function renderTimeline(events) {
  const container = document.getElementById("timeline-list");
  const todayLabel = document.getElementById("timeline-today-label");
  if (!container) {
    console.warn("Calendar UI missing #timeline-list");
    return;
  }

  if (todayLabel) {
    todayLabel.textContent = format.date(new Date());
  }

  container.innerHTML = "";

  const merged = [...(events || []), ...getBinPseudoEvents()];
  const upcoming = merged
    .filter(ev => ev.start && bucketLabel(dayDiff(ev.start)) !== null)
    .sort((a, b) => a.start - b.start);

  if (!upcoming.length) {
    container.innerHTML = `<div class="timeline-empty">Nothing scheduled</div>`;
    return;
  }

  const moments = computeTravelMoments(upcoming);
  if (moments.length) {
    const momentsBlock = document.createElement("div");
    momentsBlock.className = "timeline-moments";
    moments.forEach(moment => {
      const line = document.createElement("div");
      line.className = "timeline-moment";
      line.textContent = `${moment.icon} ${moment.text}`;
      momentsBlock.appendChild(line);
    });
    container.appendChild(momentsBlock);
  }

  const buckets = new Map();
  upcoming.forEach(ev => {
    const label = bucketLabel(dayDiff(ev.start));
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(ev);
  });

  TIMELINE_BUCKETS.forEach(label => {
    const items = buckets.get(label);
    if (!items?.length) return;

    const group = document.createElement("div");
    group.className = "timeline-group";

    const heading = document.createElement("div");
    heading.className = "timeline-group-title";
    heading.textContent = label;
    group.appendChild(heading);

    const list = document.createElement("div");
    list.className = "timeline-entries";

    items.forEach(ev => {
      const row = document.createElement("div");
      row.className = "timeline-entry";
      applyEventCategoryStyles(row, ev.category);

      const icon = document.createElement("span");
      icon.className = "timeline-entry-icon";
      icon.textContent = ev.category?.icon || DEFAULT_CATEGORY.icon;

      const title = document.createElement("span");
      title.className = "timeline-entry-title";
      title.textContent = ev.displayTitle || ev.title || "(Untitled)";

      const time = document.createElement("span");
      time.className = "timeline-entry-time";
      if (label === "Today" || label === "Tomorrow") {
        time.textContent = isAllDay(ev) ? "All day" : format.time(ev.start);
      } else {
        time.textContent = format.date(ev.start);
      }

      row.appendChild(icon);
      row.appendChild(title);
      row.appendChild(time);
      list.appendChild(row);
    });

    group.appendChild(list);
    container.appendChild(group);
  });
}

