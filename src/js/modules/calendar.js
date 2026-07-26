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

const BIN_CATEGORY = {
  id: "bins",
  label: "Bins",
  icon: "🗑️",
  accent: "#94A3B8",
  bg: "rgba(148, 163, 184, 0.12)",
  text: "#F8FAFC"
};
let binState = null;
const TODO_CATEGORY = {
  id: "todo",
  label: "To-Do",
  icon: "✅",
  accent: "#94A3B8",
  bg: "rgba(148, 163, 184, 0.12)",
  text: "#F8FAFC"
};
let todoEvents = [];
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
    path: "/icons/Food.json"
  });

  container._lottieInstance = anim;
  return anim;
}

// Destroy the lottie animations inside the given roots before their DOM is
// cleared. Setting innerHTML="" detaches the .meal-lottie spans but does NOT stop
// the lottie instance — its requestAnimationFrame loop keeps running and its SVG
// + Float32Array animation data stay retained (a zombie lottie). renderTimeline
// re-runs on every calendar refresh, so without this each pass leaked its meal
// lotties → JS heap grew ~6MB/min → renderer OOM → the kiosk "website error"
// crash. (CLAUDE.md 24/7 kiosk memory discipline.)
function destroyMealLotties(...roots) {
  for (const root of roots) {
    if (!root) continue;
    root.querySelectorAll(".meal-lottie").forEach((el) => {
      try { el._lottieInstance?.destroy(); } catch { /* best-effort teardown */ }
      el._lottieInstance = null;
    });
  }
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

function scrollTimelineToGroup(label) {
  const targetId = label === "Today" ? "timeline-rail" : "timeline-week-col";
  document.getElementById(targetId)?.scrollIntoView({ block: "start" });
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

on("timeline:scroll", ({ label } = {}) => {
  if (label) scrollTimelineToGroup(label);
});

on("todos:updated", events => {
  todoEvents = Array.isArray(events) ? events : [];
  renderTimeline(applyCalendarFilters(calendarState.eventsCache));
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
   TO-DO PSEUDO-EVENTS (only due-dated items — undated todos have no
   time-relevant place in a chronological timeline)
-------------------------------------------------------------------*/

function getTodoPseudoEvents() {
  return todoEvents.map(ev => ({
    id: `todo:${ev.title}:${ev.start}`,
    title: ev.title,
    displayTitle: ev.title,
    rawTitle: ev.title,
    category: TODO_CATEGORY,
    start: ev.start,
    end: ev.start,
    isAllDay: true
  }));
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

function timelineGlyph(ev) {
  const glyph = document.createElement("span");
  glyph.className = "timeline-glyph";
  glyph.style.setProperty("--gc", (ev.category || DEFAULT_CATEGORY).accent);
  if (MEAL_PREFIX.test(ev.rawTitle || ev.title || "")) {
    const lottie = document.createElement("span");
    lottie.className = "meal-lottie";
    glyph.appendChild(lottie);
    loadMealLottie(lottie);
  } else {
    glyph.textContent = (ev.category || DEFAULT_CATEGORY).icon;
  }
  return glyph;
}

function timelineTitle(ev) {
  const rawTitle = ev.rawTitle ?? ev.title ?? "";
  if (MEAL_PREFIX.test(rawTitle)) {
    return (ev.displayTitle ?? rawTitle).replace(MEAL_PREFIX, "").trim() || "Meal";
  }
  return ev.displayTitle || ev.title || "(Untitled)";
}

function makeTimelineStop(ev, variant) {
  const stop = document.createElement("div");
  stop.className = `timeline-stop${variant ? ` timeline-stop--${variant}` : ""}`;
  stop.appendChild(timelineGlyph(ev));

  const body = document.createElement("div");
  body.className = "timeline-stop__body";

  if (variant === "now" || variant === "next") {
    const tag = document.createElement("div");
    tag.className = "timeline-stop__tag";
    tag.textContent = variant === "now" ? "On now" : "Up next";
    body.appendChild(tag);
  }

  const time = document.createElement("div");
  time.className = "timeline-stop__time";
  time.textContent = isAllDay(ev) ? "All day" : format.time(ev.start);
  body.appendChild(time);

  const title = document.createElement("div");
  title.className = "timeline-stop__title";
  title.textContent = timelineTitle(ev);
  body.appendChild(title);

  if (variant === "now" && ev.end) {
    const now = new Date();
    const pct = Math.min(100, Math.max(0, ((now - ev.start) / (ev.end - ev.start)) * 100));
    const track = document.createElement("div");
    track.className = "timeline-stop__progress";
    track.innerHTML = `<i style="width:${pct.toFixed(1)}%"></i>`;
    body.appendChild(track);
  }

  stop.appendChild(body);

  if (variant === "next") {
    const now = new Date();
    const ms = ev.start - now;
    const mins = Math.max(0, Math.round(ms / 60000));
    let value, unit;
    if (ms <= 0) {
      value = "now";
      unit = "starting";
    } else if (mins < 60) {
      value = `${mins}m`;
      unit = "away";
    } else {
      const hh = Math.floor(mins / 60);
      const mm = mins % 60;
      value = `${hh}h${mm ? ` ${mm}m` : ""}`;
      unit = "away";
    }
    const count = document.createElement("div");
    count.className = "timeline-stop__count";
    count.innerHTML = `<b>${value}</b><span>${unit}</span>`;
    stop.appendChild(count);
  }

  return stop;
}

function renderTimeline(events) {
  const rail = document.getElementById("timeline-rail");
  const week = document.getElementById("timeline-week");
  const momentsEl = document.getElementById("timeline-moments");
  const todayLabel = document.getElementById("timeline-today-label");
  const todayCount = document.getElementById("timeline-today-count");
  const weekSpan = document.getElementById("timeline-week-span");
  if (!rail || !week) {
    console.warn("Calendar UI missing #timeline-rail/#timeline-week");
    return;
  }

  if (todayLabel) {
    todayLabel.textContent = format.date(new Date());
  }

  // Tear down the previous meal lotties before clearing, or they leak (see
  // destroyMealLotties). This is the fix for the renderer OOM crash.
  destroyMealLotties(rail, week, momentsEl);
  rail.innerHTML = "";
  week.innerHTML = "";
  if (momentsEl) momentsEl.innerHTML = "";

  const now = new Date();
  const merged = [...(events || []), ...getBinPseudoEvents(), ...getTodoPseudoEvents()];
  const upcoming = merged
    .filter(ev => ev.start && dayDiff(ev.start) >= 0)
    .sort((a, b) => a.start - b.start);

  const moments = computeTravelMoments(upcoming);
  if (momentsEl && moments.length) {
    moments.forEach(moment => {
      const line = document.createElement("div");
      line.className = "timeline-moment";
      line.textContent = `${moment.icon} ${moment.text}`;
      momentsEl.appendChild(line);
    });
  }

  const WEEK_WINDOW_DAYS = 9;
  const todayItems = upcoming.filter(ev => dayDiff(ev.start) === 0);
  const weekItems = upcoming.filter(ev => {
    const diff = dayDiff(ev.start);
    return diff > 0 && diff <= WEEK_WINDOW_DAYS;
  });

  const active = todayItems.find(ev => ev.start <= now && ev.end && ev.end > now) || null;
  const upcomingToday = todayItems.filter(ev => ev !== active && ev.start > now);
  const next = upcomingToday[0] || null;
  const later = upcomingToday.slice(1);

  let todayN = 0;
  if (active) {
    rail.appendChild(makeTimelineStop(active, "now"));
    todayN += 1;
  }

  const nowline = document.createElement("div");
  nowline.className = "timeline-nowline";
  nowline.innerHTML = `<span class="timeline-nowline__dot"></span><span class="timeline-nowline__line"></span><b>Now · ${format.time(now)}</b>`;
  rail.appendChild(nowline);

  if (next) {
    rail.appendChild(makeTimelineStop(next, "next"));
    todayN += 1;
  }
  later.forEach(ev => {
    rail.appendChild(makeTimelineStop(ev, "later"));
    todayN += 1;
  });

  if (todayN === 0) {
    const idle = document.createElement("div");
    idle.className = "timeline-idle";
    idle.textContent = "That's a wrap for today.";
    rail.appendChild(idle);
  }
  if (todayCount) {
    todayCount.textContent = todayN ? `${todayN} thing${todayN === 1 ? "" : "s"} left` : "all clear";
  }

  const dayMap = new Map();
  weekItems.forEach(ev => {
    const key = ev.start.toDateString();
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key).push(ev);
  });

  if (weekSpan) {
    weekSpan.textContent = dayMap.size ? `next ${dayMap.size} day${dayMap.size === 1 ? "" : "s"}` : "";
  }

  dayMap.forEach(items => {
    const dayRow = document.createElement("div");
    dayRow.className = "timeline-day";

    const label = document.createElement("div");
    label.className = "timeline-day__label";
    label.innerHTML = `<span class="wd">${items[0].start.toLocaleDateString("en-AU", { weekday: "short" })}</span><span class="dn">${items[0].start.getDate()}</span>`;
    dayRow.appendChild(label);

    const list = document.createElement("div");
    list.className = "timeline-day__items";
    items.forEach(ev => {
      const row = document.createElement("div");
      row.className = "timeline-day-item";
      row.style.setProperty("--gc", (ev.category || DEFAULT_CATEGORY).accent);

      const time = document.createElement("span");
      time.className = "timeline-day-item__time";
      time.textContent = isAllDay(ev) ? "All day" : format.time(ev.start);

      const glyph = timelineGlyph(ev);
      glyph.classList.add("timeline-day-item__glyph");

      const title = document.createElement("span");
      title.className = "timeline-day-item__title";
      title.textContent = timelineTitle(ev);

      row.appendChild(time);
      row.appendChild(glyph);
      row.appendChild(title);
      list.appendChild(row);
    });
    dayRow.appendChild(list);
    week.appendChild(dayRow);
  });

  if (!todayItems.length && !weekItems.length) {
    rail.innerHTML = `<div class="timeline-empty">Nothing scheduled</div>`;
  }
}

