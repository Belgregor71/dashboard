import { setNextEventActive } from "./middleSlot.js";

const WINDOW_BEFORE_MS = 30 * 60 * 1000;
const WINDOW_AFTER_MS = 15 * 60 * 1000;
const WINDOW_TOTAL_MS = WINDOW_BEFORE_MS + WINDOW_AFTER_MS;

function isAllDayEvent(ev) {
  return ev?.allDay === true || ev?.isAllDay === true || ev?.dateOnly === true;
}

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getCategoryIcon(ev) {
  return ev?.category?.icon || "📅";
}

function formatTime(value) {
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getActiveEvent(events, now) {
  const candidates = (Array.isArray(events) ? events : [])
    .filter(ev => !isAllDayEvent(ev))
    .map(ev => {
      const start = toDate(ev?.start);
      if (!start) return null;
      const showFrom = new Date(start.getTime() - WINDOW_BEFORE_MS);
      const hideAt = new Date(start.getTime() + WINDOW_AFTER_MS);
      if (now < showFrom || now > hideAt) return null;
      return { ev, start, showFrom, hideAt, started: now >= start };
    })
    .filter(Boolean);

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.started !== b.started) return a.started ? -1 : 1;
    return a.start - b.start;
  });

  return candidates[0];
}

function renderEvent(state, now) {
  const nameEl = document.getElementById("next-event-name");
  const metaEl = document.getElementById("next-event-meta");
  const progressEl = document.getElementById("next-event-progress");
  if (!nameEl || !metaEl || !progressEl) return;

  if (!state) {
    nameEl.textContent = "";
    metaEl.textContent = "";
    progressEl.style.width = "0%";
    return;
  }

  const { ev, start, showFrom } = state;
  const displayTitle = ev?.displayTitle || ev?.title || "(Untitled)";
  nameEl.textContent = `${getCategoryIcon(ev)} ${displayTitle}`;

  const deltaMinutes = Math.round((start.getTime() - now.getTime()) / 60000);
  const relative =
    deltaMinutes > 0
      ? `Starts in ${deltaMinutes} min`
      : deltaMinutes === 0
        ? "Starting now"
        : `Started ${Math.abs(deltaMinutes)} min ago`;

  metaEl.textContent = `${relative} • ${formatTime(start)}`;

  const elapsed = now.getTime() - showFrom.getTime();
  const percent = Math.min(100, Math.max(0, (elapsed / WINDOW_TOTAL_MS) * 100));
  progressEl.style.width = `${percent.toFixed(2)}%`;
}

export function initNextEventPanel(options = {}) {
  const tickMs = Number(options.tickMs) > 0 ? Number(options.tickMs) : 15_000;

  const tick = () => {
    const now = new Date();
    const events = window.__CAL_EVENTS__;
    if (!Array.isArray(events)) {
      renderEvent(null, now);
      setNextEventActive(false);
      return;
    }

    const active = getActiveEvent(events, now);
    renderEvent(active, now);
    setNextEventActive(Boolean(active));
  };

  tick();
  return setInterval(tick, tickMs);
}
