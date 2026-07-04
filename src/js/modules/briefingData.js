import { getAllEntities } from "../services/homeAssistant/state.js";
import {
  COMMUTE_ORIGIN,
  COMMUTE_GREG_DEST,
  COMMUTE_BRETT_DEST
} from "../config/config.js";

// Single gatherer for everything the briefing needs — the view's fact tiles
// and the AI prompt both render from this one context object, so what's
// displayed and what the model was told can never drift apart.

const CONTEXT_TTL_MS = 5 * 60 * 1000;
let cached = null; // { type, at, context }

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

// ── Weather ────────────────────────────────────────────────────

function normalizeWeather(now) {
  if (!now?.now) return null;
  return {
    tempC:         now.now.temp_c,
    feelsLikeC:    now.now.feels_like_c,
    condition:     now.now.condition?.label ?? null,
    windKph:       now.now.wind_kph,
    uv:            now.now.uv,
    rainChancePct: now.now.rain_chance_pct,
    highC:         now.day?.high_c ?? null,
    lowC:          now.day?.low_c ?? null,
  };
}

function pickTomorrow(forecast) {
  const days = forecast?.days ?? [];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const iso = tomorrow.toISOString().slice(0, 10);
  const day = days.find(d => d.date === iso) ?? days[1];
  if (!day) return null;
  return {
    highC:         day.high_c,
    lowC:          day.low_c,
    condition:     day.condition?.label ?? null,
    rainChancePct: day.rain_chance_pct,
  };
}

// ── Calendar ───────────────────────────────────────────────────

function eventStart(ev) {
  const raw = ev.start ?? ev.startDate ?? ev.startTime ?? ev.date;
  return raw ? new Date(raw) : null;
}

function fmtTime(d) {
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
}

function pickDay(events, dayStr) {
  return events
    .map(ev => ({ ev, start: eventStart(ev) }))
    .filter(({ start }) => start && start.toDateString() === dayStr)
    .sort((a, b) => a.start - b.start)
    .slice(0, 6)
    .map(({ ev, start }) => {
      const allDay = start.getHours() === 0 && start.getMinutes() === 0;
      return {
        title:  String(ev.title ?? ev.summary ?? "Event"),
        start,
        allDay,
        time:   allDay ? "All day" : fmtTime(start),
      };
    });
}

// ── Commute (weekday mornings only) ────────────────────────────

async function fetchDrive(destination) {
  const url = `/api/commute?origin=${encodeURIComponent(COMMUTE_ORIGIN)}` +
              `&destination=${encodeURIComponent(destination)}`;
  const data = await getJson(url);
  if (typeof data.seconds !== "number") return null;
  return {
    mins:     Math.round(data.seconds / 60),
    delayMin: Math.round((data.trafficDelaySeconds ?? 0) / 60),
  };
}

// ── Home Assistant entities ────────────────────────────────────

function readEntities() {
  let entities = {};
  try { entities = getAllEntities() ?? {}; } catch { /**/ }

  const people = Object.values(entities)
    .filter(e => e?.entity_id?.startsWith("person."))
    .map(e => ({
      name: (e.attributes?.friendly_name ?? e.entity_id.replace(/^person\./, ""))
        .split(/[\s_]+/)[0],
      home: e.state === "home",
    }));

  const media = Object.values(entities)
    .filter(e => e?.entity_id?.startsWith("media_player.") && e.state === "playing")
    .map(e => ({
      player: (e.attributes?.friendly_name ?? "Media").split(" ")[0],
      title:  e.attributes?.media_title ?? "Playing",
    }));

  const todos = Object.values(entities)
    .filter(e => e?.entity_id?.startsWith("todo."))
    .map(e => ({
      name:  e.attributes?.friendly_name ?? e.entity_id.replace(/^todo\./, ""),
      count: parseInt(e.state, 10),
    }))
    .filter(t => !isNaN(t.count));

  return { people, media, todos };
}

// ── Public API ─────────────────────────────────────────────────

export async function gatherBriefingContext(type) {
  if (cached && cached.type === type && Date.now() - cached.at < CONTEXT_TTL_MS) {
    return cached.context;
  }

  const now         = new Date();
  const day         = now.getDay();
  const wantCommute = type === "morning" && day >= 1 && day <= 5;

  const [weatherRes, forecastRes, calRes, binsRes, fuelRes, newsRes, gregRes, brettRes] =
    await Promise.allSettled([
      getJson("/api/weather/now"),
      getJson("/api/weather/forecast"),
      getJson("/api/calendar/all"),
      getJson("/api/bins"),
      getJson("/api/fuel"),
      getJson("/api/news"),
      wantCommute ? fetchDrive(COMMUTE_GREG_DEST)  : Promise.resolve(null),
      wantCommute ? fetchDrive(COMMUTE_BRETT_DEST) : Promise.resolve(null),
    ]);

  const val = (r) => (r.status === "fulfilled" ? r.value : null);

  const calData   = val(calRes);
  const allEvents = calData?.events ?? calData ?? [];
  const todayStr  = now.toDateString();
  const tomorrow  = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const binsData = val(binsRes);
  const fuelData = val(fuelRes);
  const cheapest = fuelData?.sites?.[0] ?? null;

  const greg  = val(gregRes);
  const brett = val(brettRes);

  const context = {
    type,
    generatedAt: now,
    weather:         normalizeWeather(val(weatherRes)),
    tomorrowWeather: pickTomorrow(val(forecastRes)),
    calendar: {
      today:    pickDay(allEvents, todayStr),
      tomorrow: pickDay(allEvents, tomorrow.toDateString()),
    },
    bins: binsData?.configured
      ? {
          due:     Boolean(binsData.due || binsData.eve),
          eve:     Boolean(binsData.eve),
          colours: (binsData.bins ?? []).map(b => b.charAt(0).toUpperCase() + b.slice(1)),
        }
      : null,
    fuel: cheapest
      ? { price: cheapest.price, name: cheapest.name, distanceKm: cheapest.distanceKm }
      : null,
    news:    (val(newsRes)?.headlines ?? []).slice(0, 3),
    commute: wantCommute && (greg || brett) ? { greg, brett } : null,
    ...readEntities(),
  };

  cached = { type, at: Date.now(), context };
  return context;
}
