// calendar.js
import { format } from "../helpers/dates.js";
import { emit } from "../core/eventBus.js";

const CAL_URL = "/api/calendar/all";

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

      return {
        ...ev,
        start,
        end: end || start // fallback so multi-day logic doesn’t explode
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
    div.textContent = ev.title || "(Untitled)";
    container.appendChild(div);
  });

  if (allDay.length && timed.length) {
    container.appendChild(document.createElement("br"));
  }

  timed.forEach(ev => {
    const div = document.createElement("div");
    div.className = "today-event";
    div.textContent = `${format.time(ev.start)} – ${ev.title || "(Untitled)"}`;
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
      const timed = events.filter(ev => !isAllDay(ev));

      allDay.forEach(ev => {
        const div = document.createElement("div");
        div.className = "week-all-day";
        div.textContent = ev.title || "(Untitled)";
        dayDiv.appendChild(div);
      });

      timed.forEach(ev => {
        const div = document.createElement("div");
        div.className = "week-event";
        div.textContent = `${format.time(ev.start)} – ${ev.title || "(Untitled)"}`;
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
      const label = isAllDay(ev)
        ? ev.title || "(Untitled)"
        : `${format.time(ev.start)} ${ev.title || "(Untitled)"}`;
      eventEl.textContent = label;
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
        titleEl.textContent = ev.title || "(Untitled)";
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
