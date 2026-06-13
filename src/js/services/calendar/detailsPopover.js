function ensureText(value, fallback = "—") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function initDetailsPopover(rootEl) {
  if (!rootEl) return null;
  const existing = rootEl.querySelector(".event-details-popover");
  if (existing) return createPopoverApi(existing);

  const container = document.createElement("div");
  container.className = "event-details-popover";
  container.setAttribute("aria-hidden", "true");

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "event-details-popover__backdrop";
  backdrop.setAttribute("aria-label", "Close event details");

  const card = document.createElement("section");
  card.className = "event-details-popover__card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  card.innerHTML = `
    <div class="event-details-popover__header">
      <h3 class="event-details-popover__title">Event details</h3>
      <button type="button" class="event-details-popover__close" aria-label="Close details">✕</button>
    </div>
    <div class="event-details-popover__meta">
      <div data-field="time"></div>
      <div data-field="allday" class="is-hidden"></div>
      <div data-field="location"></div>
      <div data-field="calendar"></div>
      <div data-field="travel" class="is-hidden"></div>
    </div>
    <div class="event-details-popover__notes" data-field="notes"></div>
    <div class="event-details-popover__attendees" data-field="attendees"></div>
  `;

  container.appendChild(backdrop);
  container.appendChild(card);
  rootEl.appendChild(container);

  const api = createPopoverApi(container);
  backdrop.addEventListener("click", () => api.closeDetails());
  card.querySelector(".event-details-popover__close")?.addEventListener("click", () => api.closeDetails());

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && api.isOpen()) {
      api.closeDetails();
    }
  });

  return api;
}

function createPopoverApi(container) {
  const titleEl = container.querySelector(".event-details-popover__title");
  const timeEl = container.querySelector('[data-field="time"]');
  const allDayEl = container.querySelector('[data-field="allday"]');
  const locationEl = container.querySelector('[data-field="location"]');
  const calendarEl = container.querySelector('[data-field="calendar"]');
  const notesEl = container.querySelector('[data-field="notes"]');
  const attendeesEl = container.querySelector('[data-field="attendees"]');
  const travelEl = container.querySelector('[data-field="travel"]');

  return {
    openDetails(eventObj = {}) {
      const title = ensureText(eventObj.displayTitle || eventObj.title, "(Untitled)");
      const isAllDay = Boolean(eventObj.isAllDay || eventObj.allDay);
      const attendees = Array.isArray(eventObj.attendees) ? eventObj.attendees : [];

      if (titleEl) titleEl.textContent = title;
      if (timeEl) {
        timeEl.textContent = isAllDay
          ? `${formatDateTime(eventObj.start)} – ${formatDateTime(eventObj.end)}`
          : `${formatDateTime(eventObj.start)} – ${formatDateTime(eventObj.end)}`;
      }
      if (allDayEl) {
        allDayEl.textContent = "All-day event";
        allDayEl.classList.toggle("is-hidden", !isAllDay);
      }
      if (locationEl) {
        locationEl.textContent = `Location: ${ensureText(eventObj.location, "Not set")}`;
      }
      if (calendarEl) {
        const source = ensureText(eventObj.source, "calendar");
        const calendar = ensureText(eventObj.calendar, "default");
        calendarEl.textContent = `Source: ${source} • ${calendar}`;
      }
      if (notesEl) {
        notesEl.textContent = ensureText(eventObj.description || eventObj.notes, "No notes available.");
      }
      if (attendeesEl) {
        attendeesEl.textContent = attendees.length
          ? `Attendees: ${attendees.join(", ")}`
          : "Attendees: none listed";
      }
      if (travelEl) {
        if (eventObj.travelTimeText) {
          travelEl.textContent = `Travel: ${eventObj.travelTimeText}`;
          travelEl.classList.remove("is-hidden");
        } else {
          travelEl.classList.add("is-hidden");
        }
      }

      container.classList.add("is-open");
      container.setAttribute("aria-hidden", "false");
    },
    closeDetails() {
      container.classList.remove("is-open");
      container.setAttribute("aria-hidden", "true");
    },
    isOpen() {
      return container.classList.contains("is-open");
    }
  };
}
