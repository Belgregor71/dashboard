// calendar.js
import { format } from "../helpers/dates.js";

const CAL_URL = "/api/calendar/all";

/* ------------------------------------------------------------------
   MAIN REFRESH FUNCTION
-------------------------------------------------------------------*/

export async function refreshCalendar() {
  try {
    const res = await fetch(CAL_URL);
    const events = await res.json();

    console.log("Events received:", events);

    // Normalize dates to LOCAL TIME
    const normalized = normalizeEvents(events);

    const expanded = expandMultiDay(normalized);
    const todayEvents = getTodayEvents(expanded);
    const weekEvents = getNext7DaysEvents(expanded);

    renderToday(todayEvents);
    renderWeek(weekEvents);
  } catch (err) {
    console.error("Calendar error:", err);
  }
}

/* ------------------------------------------------------------------
   NORMALIZE EVENT DATES TO LOCAL TIME
-------------------------------------------------------------------*/

function toLocal(date) {
  const d = new Date(date);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
}

function normalizeEvents(events) {
  return events.map(ev => ({
    ...ev,
    start: toLocal(ev.start),
    end: toLocal(ev.end)
  }));
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

    if (start.toDateString() !== end.toDateString()) {
      let d = new Date(start);
      while (d <= end) {
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
  return date.toDateString() === now.toDateString();
}

function getTodayEvents(events) {
  return events.filter(ev => isToday(ev.start));
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
    events: events.filter(ev => ev.start.toDateString() === day.toDateString())
  }));
}

/* ------------------------------------------------------------------
   RENDER: TODAY PANEL
-------------------------------------------------------------------*/

function renderToday(events) {
  const container = document.getElementById("today-list");
  container.innerHTML = "";

  if (events.length === 0) {
    container.innerHTML = `<div class="today-empty">Nothing scheduled</div>`;
    return;
  }

  const allDay = events.filter(isAllDay);
  const timed = events.filter(ev => !isAllDay(ev));

  allDay.forEach(ev => {
    const div = document.createElement("div");
    div.className = "today-all-day";
    div.textContent = ev.title;
    container.appendChild(div);
  });

  if (allDay.length && timed.length) {
    container.appendChild(document.createElement("br"));
  }

  timed.forEach(ev => {
    const div = document.createElement("div");
    div.className = "today-event";
    div.textContent = `${format.time(ev.start)} – ${ev.title}`;
    container.appendChild(div);
  });
}

/* ------------------------------------------------------------------
   RENDER: WEEK PANEL (with weather icon placeholders)
-------------------------------------------------------------------*/

function renderWeek(days) {
  const container = document.getElementById("weekly-list");
  container.innerHTML = "";

  days.forEach(({ date, events }, index) => {
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

    if (events.length === 0) {
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
        div.textContent = ev.title;
        dayDiv.appendChild(div);
      });

      timed.forEach(ev => {
        const div = document.createElement("div");
        div.className = "week-event";
        div.textContent = `${format.time(ev.start)} – ${ev.title}`;
        dayDiv.appendChild(div);
      });
    }

    container.appendChild(dayDiv);
  });
}
