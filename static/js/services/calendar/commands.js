import { getCurrentView, switchView } from "../../core/viewManager.js";

const hooks = {
  nextMonth: null,
  previousMonth: null,
  goToday: null,
  showAgenda: null,
  showBirthdays: null,
  showDetails: null,
  closeDetails: null,
  detailsForNextEvent: null
};

function normalize(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function toCommand(raw, payload = {}) {
  const normalized = normalize(raw || payload.command || payload.intent || payload.action || payload.text);
  if (!normalized) return "";

  const map = {
    next_month: "next_month",
    previous_month: "previous_month",
    prev_month: "previous_month",
    go_to_today: "go_today",
    today: "go_today",
    show_agenda: "show_agenda",
    show_birthdays: "show_birthdays",
    show_details: "show_details",
    close_details: "close_details",
    details_for_next_event: "details_for_next_event"
  };

  return map[normalized] || normalized;
}

function ensureCalendarVisible(command) {
  const current = getCurrentView();
  if (["show_agenda"].includes(command)) {
    if (current !== "agenda") switchView("agenda");
    return;
  }
  if (current !== "calendar") switchView("calendar");
}

export function registerCalendarCommandHandlers(nextHooks = {}) {
  Object.assign(hooks, nextHooks);
}

export function handleCalendarCommand(commandString, payload = {}) {
  const command = toCommand(commandString, payload);
  if (!command) return false;

  const handlers = {
    next_month: hooks.nextMonth,
    previous_month: hooks.previousMonth,
    go_today: hooks.goToday,
    show_agenda: hooks.showAgenda,
    show_birthdays: hooks.showBirthdays,
    show_details: hooks.showDetails,
    close_details: hooks.closeDetails,
    details_for_next_event: hooks.detailsForNextEvent
  };

  const handler = handlers[command];
  if (typeof handler !== "function") return false;
  ensureCalendarVisible(command);
  handler(payload);
  return true;
}
