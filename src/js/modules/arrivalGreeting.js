import { wakeScreensaver, resetIdleTimer } from "./screensaver.js";
import { speak } from "../core/tts.js";
import { getAllEntities } from "../services/homeAssistant/state.js";

const DURATION_MS  = 15_000;           // how long the card stays visible
const COOLDOWN_MS  = 10 * 60 * 1000;  // suppress re-greeting within 10 min

const cooldowns = new Map(); // entityId → expiry timestamp
const lastKnownState = new Map(); // entityId → last seen state

// ── Helpers ───────────────────────────────────────────────────

function firstName(entity) {
  const full = String(entity.attributes?.friendly_name ?? "").trim();
  if (full) return full.split(" ")[0];
  // Fallback: person.greg_dee → "Greg"
  const id = String(entity.entity_id ?? "").replace(/^person\./, "");
  const word = id.split(/[_\s]/)[0];
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function getPeopleAlreadyHome(excludeId) {
  return Object.values(getAllEntities())
    .filter(e =>
      e?.entity_id?.startsWith("person.") &&
      e.entity_id !== excludeId &&
      e.state === "home"
    )
    .map(firstName);
}

async function getRemainingTodayEvents() {
  try {
    const res  = await fetch("/api/calendar/all");
    const data = await res.json();
    const now  = new Date();
    const dayStr = now.toDateString();

    return (data.events ?? data ?? [])
      .filter(ev => {
        const d = new Date(ev.start ?? ev.startDate ?? ev.date);
        if (d.toDateString() !== dayStr) return false;
        // Include all-day events and future timed events
        const isAllDay = d.getHours() === 0 && d.getMinutes() === 0;
        return isAllDay || d > now;
      })
      .slice(0, 3)
      .map(ev => {
        const title = String(ev.title ?? ev.summary ?? "Event");
        const start = ev.start ?? ev.startDate;
        if (!start) return { title, time: null };
        const d = new Date(start);
        const isAllDay = d.getHours() === 0 && d.getMinutes() === 0;
        const time = isAllDay
          ? null
          : d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
        return { title, time };
      });
  } catch {
    return [];
  }
}

// ── Speech ────────────────────────────────────────────────────

function buildSpeech(name, others, events) {
  let msg = `Welcome home, ${name}!`;

  if (events.length === 1) {
    const e = events[0];
    msg += e.time
      ? ` You have ${e.title} at ${e.time} this evening.`
      : ` You have ${e.title} today.`;
  } else if (events.length > 1) {
    const parts = events.slice(0, 2).map(e => e.time ? `${e.title} at ${e.time}` : e.title);
    msg += ` You have ${parts.join(", and ")} this evening.`;
  } else {
    msg += " Nothing else on the calendar tonight.";
  }

  if (others.length === 1)      msg += ` ${others[0]} is already home.`;
  else if (others.length > 1)   msg += ` ${others.join(" and ")} are already home.`;

  return msg;
}

// ── Overlay DOM ───────────────────────────────────────────────

let overlayEl      = null;
let dismissTimer   = null;
let progressTimer  = null;

function ensureOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement("div");
  overlayEl.id = "arrival-greeting";
  overlayEl.className = "arrival-greeting";
  overlayEl.setAttribute("aria-live", "assertive");
  document.body.appendChild(overlayEl);
}

function eventsHtml(events) {
  if (events.length === 0) {
    return `<p class="arrival-greeting__empty">Nothing else on the calendar tonight.</p>`;
  }
  const items = events.map(e =>
    `<li>
      ${e.time ? `<span class="arrival-greeting__time">${e.time}</span>` : ""}
      <span class="arrival-greeting__event-title">${e.title}</span>
    </li>`
  ).join("");
  return `<ul class="arrival-greeting__events">${items}</ul>`;
}

function homeStatusText(others) {
  if (others.length === 0) return "You're the first one home.";
  if (others.length === 1) return `${others[0]} is already home.`;
  return `${others.join(" and ")} are already home.`;
}

function showCard(name, others, events) {
  ensureOverlay();
  clearTimeout(dismissTimer);
  clearInterval(progressTimer);

  overlayEl.innerHTML = `
    <div class="arrival-greeting__card">
      <div class="arrival-greeting__welcome">Welcome home, ${name}!</div>
      <div class="arrival-greeting__status">${homeStatusText(others)}</div>
      ${eventsHtml(events)}
      <div class="arrival-greeting__track">
        <div class="arrival-greeting__bar" id="arrival-bar"></div>
      </div>
    </div>
  `;

  // Trigger enter animation on next frame
  requestAnimationFrame(() => overlayEl.classList.add("is-active"));

  // Drain the countdown bar
  const bar = overlayEl.querySelector("#arrival-bar");
  const start = Date.now();
  progressTimer = setInterval(() => {
    if (!bar) return;
    const pct = Math.max(0, 100 - ((Date.now() - start) / DURATION_MS) * 100);
    bar.style.width = `${pct}%`;
  }, 80);

  dismissTimer = setTimeout(hideCard, DURATION_MS);
}

function hideCard() {
  clearTimeout(dismissTimer);
  clearInterval(progressTimer);
  dismissTimer  = null;
  progressTimer = null;
  overlayEl?.classList.remove("is-active");
}

// ── Init ──────────────────────────────────────────────────────

export function initArrivalGreeting() {
  document.addEventListener("ha:state-updated", async (event) => {
    const entity   = event.detail;
    const entityId = String(entity?.entity_id ?? "");
    const state    = String(entity?.state    ?? "");

    if (!entityId.startsWith("person.")) return;

    // The initial HA snapshot dispatches an "ha:state-updated" for every
    // entity, including people already home - that's not an arrival. Only
    // greet on a genuine away->home transition observed during this session.
    const previousState = lastKnownState.get(entityId);
    lastKnownState.set(entityId, state);
    if (state !== "home") return;
    if (previousState === undefined || previousState === "home") return;

    const now = Date.now();
    if ((cooldowns.get(entityId) ?? 0) > now) return;
    cooldowns.set(entityId, now + COOLDOWN_MS);

    const name   = firstName(entity);
    const others = getPeopleAlreadyHome(entityId);
    const events = await getRemainingTodayEvents();

    wakeScreensaver();
    resetIdleTimer();

    showCard(name, others, events);
    speak(buildSpeech(name, others, events));
  });
}
