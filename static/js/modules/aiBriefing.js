import { getAllEntities } from "../services/homeAssistant/state.js";

// Shared context builder + Ollama caller.
// type: "morning" (day ahead) | "evening" (tonight + tomorrow)

export async function generateBriefing({ type = "morning" } = {}) {
  const now       = new Date();
  const todayStr  = now.toDateString();
  const tomorrow  = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toDateString();

  // Parallel fetches
  const [calResult, binsResult] = await Promise.allSettled([
    fetch("/api/calendar/all").then(r => r.json()),
    fetch("/api/bins").then(r => r.json()),
  ]);

  const calData  = calResult.status  === "fulfilled" ? calResult.value  : {};
  const binsData = binsResult.status === "fulfilled" ? binsResult.value : {};
  const allEvents = calData.events ?? calData ?? [];

  // ── Weather (already rendered in DOM) ─────────────────────────
  const temp    = document.getElementById("current-temp")?.textContent?.trim() ?? "";
  const cond    = document.getElementById("current-conditions")?.textContent?.trim() ?? "";
  const range   = document.getElementById("weather-range")?.textContent?.trim() ?? "";
  const feels   = document.getElementById("weather-feels-like-large")?.textContent?.trim().replace(/^--$/, "") ?? "";
  const rain    = document.getElementById("weather-rain-range-card")?.textContent?.trim().replace(/^--$/, "") ?? "";
  const uvNum   = document.getElementById("weather-uv-dial-value")?.textContent?.trim().replace(/^--$/, "") ?? "";
  const uvCat   = document.getElementById("weather-uv-dial-meta")?.textContent?.trim() ?? "";

  const weatherParts = [];
  if (temp && cond) weatherParts.push(`${temp}, ${cond}`);
  if (range)        weatherParts.push(range);
  if (feels)        weatherParts.push(`feels like ${feels}`);
  if (rain)         weatherParts.push(`rain ${rain}`);
  if (uvNum)        weatherParts.push(uvCat ? `UV ${uvNum} (${uvCat})` : `UV ${uvNum}`);
  const weather = weatherParts.join(". ") || null;

  // ── Calendar ───────────────────────────────────────────────────
  function fmtEvent(ev) {
    const title = String(ev.title ?? ev.summary ?? "Event");
    const raw   = ev.start ?? ev.startDate;
    if (!raw) return title;
    const d = new Date(raw);
    if (d.getHours() === 0 && d.getMinutes() === 0) return title;
    const t = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
    return `${title} at ${t}`;
  }

  let eventContext;

  if (type === "evening") {
    const todayLeft = allEvents
      .filter(ev => {
        const raw = ev.start ?? ev.startDate ?? ev.date;
        if (!raw) return false;
        const d = new Date(raw);
        if (d.toDateString() !== todayStr) return false;
        return d.getHours() === 0 || d > now; // all-day or still upcoming
      })
      .slice(0, 2)
      .map(fmtEvent);

    const tomorrowEvents = allEvents
      .filter(ev => {
        const raw = ev.start ?? ev.startDate ?? ev.date;
        return raw && new Date(raw).toDateString() === tomorrowStr;
      })
      .slice(0, 3)
      .map(fmtEvent);

    const parts = [];
    if (todayLeft.length)    parts.push(`Tonight: ${todayLeft.join("; ")}`);
    if (tomorrowEvents.length) parts.push(`Tomorrow: ${tomorrowEvents.join("; ")}`);
    eventContext = parts.length ? parts.join(". ") : "Nothing on tonight or tomorrow";
  } else {
    const todayEvents = allEvents
      .filter(ev => {
        const raw = ev.start ?? ev.startDate ?? ev.date;
        return raw && new Date(raw).toDateString() === todayStr;
      })
      .slice(0, 4)
      .map(fmtEvent);
    eventContext = todayEvents.length ? todayEvents.join("; ") : "Nothing scheduled today";
  }

  // ── Bins ───────────────────────────────────────────────────────
  let binsText = null;
  if (binsData?.configured && (binsData.due || binsData.eve)) {
    const colours = (binsData.bins ?? [])
      .map(b => b.charAt(0).toUpperCase() + b.slice(1))
      .join(" + ");
    binsText = `${binsData.eve ? "tonight" : "today"}: ${colours}`;
  }

  // ── Home status ────────────────────────────────────────────────
  let entities = {};
  try { entities = getAllEntities() ?? {}; } catch { /**/ }

  const people = Object.values(entities)
    .filter(e => e?.entity_id?.startsWith("person."))
    .map(e => {
      const name = (e.attributes?.friendly_name ?? e.entity_id.replace(/^person\./, ""))
        .split(/[\s_]+/)[0];
      return `${name} is ${e.state === "home" ? "home" : "away"}`;
    });

  // ── Build + send ───────────────────────────────────────────────
  const time = now.toLocaleString("en-AU", {
    weekday: "long", hour: "numeric", minute: "2-digit", hour12: true,
  });

  const res = await fetch("/api/ai/brief", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type,
      time,
      weather,
      events: eventContext,
      bins:   binsText,
      home:   people.length ? people.join(", ") : null,
    }),
    signal: AbortSignal.timeout(28_000),
  });

  if (!res.ok) throw new Error(`AI brief HTTP ${res.status}`);
  const data = await res.json();
  return data.summary?.trim() || null;
}
