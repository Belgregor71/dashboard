import { wakeScreensaver, resetIdleTimer } from "./screensaver.js";
import { speak } from "../core/tts.js";
import { getAllEntities } from "../services/homeAssistant/state.js";
import { emit, on } from "../core/eventBus.js";
import { get as getContext } from "../core/contextStore.js";
import { phrase, timing } from "../core/personality.js";

const DURATION_MS  = 15_000;           // how long the card stays visible
const COOLDOWN_MS  = 10 * 60 * 1000;  // suppress re-greeting within 10 min

const cooldowns = new Map(); // entityId → expiry timestamp
const lastKnownState = new Map(); // entityId → last seen state
const lastAwayAt = new Map(); // entityId → when they left home (Phase 10 away-duration)

// Study 03 (WP3) — the glass-card treatment. Flag-gated so flag-off keeps the
// current cool card + JS-width drain byte-identical.
let arrivalCardOn = false;
// Tier-1b spec reshape (features.arrivalBottom, requires arrivalCard): the card
// sits bottom-center and slides up, welcome 64px with the name in --warm.
let arrivalBottomOn = false;
// Set synchronously when personalityRuntime fires the home-after-away delight
// (emit is sync, so it lands before showCard reads it), then consumed once by the
// very next card so a ≥2-day absence shows the warm, agenda-free variant.
let pendingWarm = false;

// Phase 10 personality (docs/vision/phase-10-temperament.md) — flag-gated so
// flag-off keeps the welcome copy + arrival behaviour byte-identical.
function personalityEnabled() {
  try {
    return Boolean(window.CONFIG?.features?.personality);
  } catch {
    return false;
  }
}

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
  let msg = `Welcome home, ${name}.`;

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

  // Study 03: mark the card so the glass CSS engages, and source the enter/exit
  // slide + the drain length from the timing authority (personality.timing).
  // Flag-off: no class, no vars → the original cool card + JS drain, byte-identical.
  if (arrivalCardOn) {
    overlayEl.classList.add("arrival-card");
    if (arrivalBottomOn) overlayEl.classList.add("arrival-bottom");
    const t = timing("arrival");
    overlayEl.style.setProperty("--arrival-settle", `${t.settleMs}ms`);
    overlayEl.style.setProperty("--arrival-ease", t.easing);
    overlayEl.style.setProperty("--arrival-duration", `${DURATION_MS}ms`);
  }

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

  // Study 03: a ≥2-day absence trips the budgeted home-after-away delight, which
  // fires (sync) just before this via emit("arrival:home") → the warm variant
  // drops the agenda and leaves just the welcome. Consumed once per card.
  const warm = arrivalCardOn && pendingWarm;
  pendingWarm = false;

  // Phase 10: the welcome headline speaks in the house's one voice (flag-off →
  // the literal string, byte-identical).
  let welcome = personalityEnabled()
    ? phrase(getContext().intent, "arrival", { text: `Welcome home, ${name}.` })
    : `Welcome home, ${name}.`;
  // Spec reshape: the name renders in --warm/600 (the handoff's sanctioned
  // exception). phrase() may reword the line, so wrap the name only if it
  // survived — a rewrite without it just renders plain.
  if (arrivalBottomOn) welcome = welcome.replace(name, `<b>${name}</b>`);

  overlayEl.classList.toggle("arrival-greeting--warm", warm);

  overlayEl.innerHTML = `
    <div class="arrival-greeting__card">
      <div class="arrival-greeting__welcome">${welcome}</div>
      <div class="arrival-greeting__status">${homeStatusText(others)}</div>
      ${eventsHtml(events)}
      <div class="arrival-greeting__track">
        <div class="arrival-greeting__bar" id="arrival-bar"></div>
      </div>
    </div>
  `;

  // Trigger enter animation on next frame
  requestAnimationFrame(() => overlayEl.classList.add("is-active"));

  if (arrivalCardOn) {
    // Study 03: the countdown is a CSS transform (scaleX) animation keyed off
    // .is-active — no per-arrival JS interval to leak. Only the single dismiss
    // timer remains, cleared symmetrically in hideCard.
    dismissTimer = setTimeout(hideCard, DURATION_MS);
    return;
  }

  // Flag-off path: the original JS-width drain, byte-identical.
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

export function initArrivalGreeting({ arrivalCardEnabled = false, arrivalBottomEnabled = false } = {}) {
  arrivalCardOn = arrivalCardEnabled === true;
  arrivalBottomOn = arrivalCardOn && arrivalBottomEnabled === true; // rides on the card

  // Study 03: a fired home-after-away delight (a ≥2-day absence, budgeted so it
  // stays rare) arms the warm variant for the card that's about to show. The
  // emit chain is synchronous, so this lands before showCard reads pendingWarm.
  if (arrivalCardOn) {
    on("delight:fired", ({ id } = {}) => {
      if (id === "home-after-away") pendingWarm = true;
    });

    // Read-only probe + a force hook for the on-Pi verify (no real HA transition
    // needed). __forceArrival({ warm }) renders a card exactly as an arrival would.
    window.__arrivalCard = () => {
      const card = overlayEl?.querySelector(".arrival-greeting__card");
      const cs = card ? getComputedStyle(card) : null;
      return {
        enabled: arrivalCardOn,
        present: Boolean(overlayEl),
        active: Boolean(overlayEl?.classList.contains("is-active")),
        warm: Boolean(overlayEl?.classList.contains("arrival-greeting--warm")),
        pendingWarm,
        borderTop: cs ? cs.borderTopColor : null,
        backdropFilter: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null
      };
    };
    window.__forceArrival = ({ name = "Greg", warm = false } = {}) => {
      pendingWarm = warm === true;
      wakeScreensaver();
      resetIdleTimer();
      showCard(name, getPeopleAlreadyHome(`person.__force_${name}`), warm ? [] : [
        { title: "Dinner with Sam", time: "7:30 pm" }
      ]);
      return window.__arrivalCard();
    };
  }

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
    if (state !== "home") {
      // Note when they leave, so an arrival can measure the absence (Phase 10).
      if (personalityEnabled() && previousState === "home") lastAwayAt.set(entityId, Date.now());
      return;
    }
    if (previousState === undefined || previousState === "home") return;

    const now = Date.now();
    if ((cooldowns.get(entityId) ?? 0) > now) return;
    cooldowns.set(entityId, now + COOLDOWN_MS);

    const name   = firstName(entity);
    const others = getPeopleAlreadyHome(entityId);
    const events = await getRemainingTodayEvents();

    // Phase 10: hand the absence duration to the delight registry (home-after-away
    // moment). Emitted only when the flag is on → flag-off behaviour is unchanged.
    if (personalityEnabled()) {
      const awayAt = lastAwayAt.get(entityId);
      lastAwayAt.delete(entityId);
      emit("arrival:home", { name, awayMs: awayAt ? Date.now() - awayAt : 0 });
    }

    wakeScreensaver();
    resetIdleTimer();

    showCard(name, others, events);
    speak(buildSpeech(name, others, events));
  });
}
