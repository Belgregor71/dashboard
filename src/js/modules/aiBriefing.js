import { getAllEntities } from "../services/homeAssistant/state.js";

// Shared context builder + Ollama caller used by briefingView and voiceCommands.

export async function generateBriefing() {
  const now = new Date();

  // Parallel fetches
  const [calResult, binsResult] = await Promise.allSettled([
    fetch("/api/calendar/all").then(r => r.json()),
    fetch("/api/bins").then(r => r.json()),
  ]);

  const calData  = calResult.status  === "fulfilled" ? calResult.value  : {};
  const binsData = binsResult.status === "fulfilled" ? binsResult.value : {};

  // ── Weather (already rendered in DOM) ─────────────────────────
  const temp  = document.getElementById("current-temp")?.textContent?.trim() ?? "";
  const cond  = document.getElementById("current-conditions")?.textContent?.trim() ?? "";
  const range = document.getElementById("weather-range")?.textContent?.trim() ?? "";
  const weather = [temp && cond ? `${temp}, ${cond}` : "", range].filter(Boolean).join(". ") || null;

  // ── Calendar ───────────────────────────────────────────────────
  const todayStr = now.toDateString();
  const events = (calData.events ?? calData ?? [])
    .filter(ev => {
      const raw = ev.start ?? ev.startDate ?? ev.date;
      return raw && new Date(raw).toDateString() === todayStr;
    })
    .slice(0, 4)
    .map(ev => {
      const title = String(ev.title ?? ev.summary ?? "Event");
      const raw   = ev.start ?? ev.startDate;
      if (!raw) return title;
      const d = new Date(raw);
      if (d.getHours() === 0 && d.getMinutes() === 0) return title;
      const t = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
      return `${title} at ${t}`;
    });

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
      time,
      weather,
      events:  events.length ? events.join("; ") : "Nothing scheduled today",
      bins:    binsText,
      home:    people.length ? people.join(", ") : null,
    }),
    signal: AbortSignal.timeout(28_000),
  });

  if (!res.ok) throw new Error(`AI brief HTTP ${res.status}`);
  const data = await res.json();
  return data.summary?.trim() || null;
}
