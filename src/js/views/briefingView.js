import { getAllEntities } from "../services/homeAssistant/state.js";

const REFRESH_MS = 10 * 60 * 1000;

// ── DOM helpers ────────────────────────────────────────────────

function listHtml(items, emptyText = "Nothing to show.") {
  if (!items.length) return `<p class="bl-empty">${emptyText}</p>`;
  return `<ul>${items.map(it =>
    it.divider
      ? `<li class="bl-divider">${it.label}</li>`
      : `<li><span class="bl-label">${it.label}</span><span${it.dim ? ' class="bl-val--dim"' : ""}>${it.value}</span></li>`
  ).join("")}</ul>`;
}

// ── Headline ───────────────────────────────────────────────────

function buildHeadline() {
  const hour = new Date().getHours();
  const day  = new Date().toLocaleDateString("en-AU", { weekday: "long" });
  if (hour >= 5  && hour < 12) return `Good morning. Here's your ${day}.`;
  if (hour >= 12 && hour < 17) return "Good afternoon. Here's where things stand.";
  if (hour >= 17 && hour < 21) return "Good evening. Here's tonight.";
  return "Here's the overnight rundown.";
}

// ── Weather: read already-rendered DOM strip ───────────────────

function renderWeather() {
  const temp  = document.getElementById("current-temp")?.textContent?.trim() ?? "";
  const cond  = document.getElementById("current-conditions")?.textContent?.trim() ?? "";
  const range = document.getElementById("weather-range")?.textContent?.trim() ?? "";
  const wind  = document.getElementById("weather-wind-text")?.textContent?.trim() ?? "";

  const items = [];
  if (temp || cond) items.push({ label: "Now",   value: [temp, cond].filter(Boolean).join(" — ") });
  if (range)        items.push({ label: "Range",  value: range });
  if (wind)         items.push({ label: "Wind",   value: wind });

  return listHtml(items, "Weather data not available.");
}

// ── Calendar ───────────────────────────────────────────────────

function fmtTime(ev) {
  const raw = ev.start ?? ev.startDate ?? ev.startTime ?? ev.date;
  if (!raw) return "";
  const d = new Date(raw);
  if (d.getHours() === 0 && d.getMinutes() === 0) return "All day";
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
}

async function fetchCalendar() {
  const res    = await fetch("/api/calendar/all");
  const data   = await res.json();
  const events = data.events ?? data ?? [];

  const now         = new Date();
  const todayStr    = now.toDateString();
  const tomorrow    = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toDateString();

  const pickDay = (str) =>
    events
      .filter(ev => {
        const raw = ev.start ?? ev.startDate ?? ev.date ?? ev.startTime;
        return raw && new Date(raw).toDateString() === str;
      })
      .slice(0, 4)
      .map(ev => ({ time: fmtTime(ev), title: String(ev.title ?? ev.summary ?? "Event") }));

  return { today: pickDay(todayStr), tomorrow: pickDay(tomorrowStr) };
}

function renderCalendar({ today, tomorrow }) {
  const items = [];
  today.forEach(ev => items.push({ label: ev.time || "All day", value: ev.title }));
  if (tomorrow.length) {
    if (items.length) items.push({ divider: true, label: "Tomorrow" });
    tomorrow.slice(0, 2).forEach(ev => items.push({ label: ev.time || "All day", value: ev.title }));
  }
  return listHtml(items, "Nothing on the calendar.");
}

// ── Home status ────────────────────────────────────────────────

function renderHome() {
  let entities = {};
  try { entities = getAllEntities() ?? {}; } catch { /**/ }

  const people = Object.values(entities)
    .filter(e => e?.entity_id?.startsWith("person."))
    .map(e => {
      const name = (e.attributes?.friendly_name ?? e.entity_id.replace(/^person\./, ""))
        .split(/[\s_]+/)[0];
      const home = e.state === "home";
      return { label: name, value: home ? "Home" : "Away", dim: !home };
    });

  const playing = Object.values(entities)
    .filter(e => e?.entity_id?.startsWith("media_player.") && e.state === "playing")
    .map(e => ({
      label: (e.attributes?.friendly_name ?? "Media").split(" ")[0],
      value: e.attributes?.media_title ?? "Playing"
    }));

  return listHtml([...people, ...playing], "No home status available.");
}

// ── Tasks + Bins ───────────────────────────────────────────────

async function fetchBins() {
  const res = await fetch("/api/bins");
  return await res.json();
}

function renderTasks(bins) {
  const items = [];

  if (bins?.configured) {
    if (bins.due || bins.eve) {
      const when    = bins.eve ? "Tonight" : "Today";
      const colours = (bins.bins ?? [])
        .map(b => b.charAt(0).toUpperCase() + b.slice(1))
        .join(" + ");
      items.push({ label: "Bins", value: `${when}: ${colours}` });
    } else {
      items.push({ label: "Bins", value: "Not due", dim: true });
    }
  }

  let entities = {};
  try { entities = getAllEntities() ?? {}; } catch { /**/ }

  Object.values(entities)
    .filter(e => e?.entity_id?.startsWith("todo."))
    .forEach(e => {
      const count = parseInt(e.state, 10);
      if (isNaN(count)) return;
      const name = e.attributes?.friendly_name ?? e.entity_id.replace(/^todo\./, "");
      items.push({
        label: name,
        value: `${count} item${count !== 1 ? "s" : ""}`,
        dim:   count === 0
      });
    });

  return listHtml(items, "No tasks or reminders.");
}

// ── View factory ───────────────────────────────────────────────

export function createBriefingView() {
  const root          = document.getElementById("briefing-view");
  const generatedAtEl = document.getElementById("briefing-generated-at");
  const headlineEl    = document.getElementById("briefing-headline");
  const weatherEl     = document.getElementById("briefing-weather");
  const calendarEl    = document.getElementById("briefing-calendar");
  const homeEl        = document.getElementById("briefing-home");
  const tasksEl       = document.getElementById("briefing-tasks");

  if (!root || !headlineEl) {
    return { render: () => {}, onEnter: () => {}, onLeave: () => {} };
  }

  let refreshTimer = null;

  function setLoading() {
    headlineEl.textContent = "Loading briefing…";
    const placeholder = '<p class="bl-empty">Loading…</p>';
    weatherEl.innerHTML  = placeholder;
    calendarEl.innerHTML = placeholder;
    homeEl.innerHTML     = placeholder;
    tasksEl.innerHTML    = placeholder;
  }

  async function loadBrief() {
    setLoading();

    const [calResult, binsResult] = await Promise.allSettled([
      fetchCalendar(),
      fetchBins()
    ]);

    headlineEl.textContent        = buildHeadline();
    generatedAtEl.textContent     = `Updated ${new Date().toLocaleTimeString("en-AU", {
      hour: "numeric", minute: "2-digit", hour12: true
    })}`;

    weatherEl.innerHTML  = renderWeather();
    calendarEl.innerHTML = calResult.status === "fulfilled"
      ? renderCalendar(calResult.value)
      : '<p class="bl-empty">Calendar unavailable.</p>';
    homeEl.innerHTML     = renderHome();
    tasksEl.innerHTML    = renderTasks(
      binsResult.status === "fulfilled" ? binsResult.value : null
    );
  }

  function render() {
    generatedAtEl.textContent = "";
    setLoading();
  }

  function onEnter() {
    loadBrief();
    if (!refreshTimer) refreshTimer = setInterval(loadBrief, REFRESH_MS);
  }

  function onLeave() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  return { render, onEnter, onLeave };
}
