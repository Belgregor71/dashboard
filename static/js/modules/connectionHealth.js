import { on } from "../core/eventBus.js";

const SOURCES = ["ha", "weather", "calendar", "commute"];
const state = Object.fromEntries(SOURCES.map((source) => [source, { status: "unknown", ts: 0 }]));

function getSummary() {
  const values = Object.values(state).map((entry) => entry.status);
  if (values.includes("down")) return "down";
  if (values.includes("warn") || values.includes("unknown")) return "warn";
  return "ok";
}

function relativeAge(ts) {
  if (!ts) return "never";
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (minutes < 1) return "just now";
  return `${minutes}m ago`;
}

function render() {
  const dot = document.querySelector(".connection-health-chip__dot");
  const text = document.getElementById("connection-health-chip-text");
  if (!dot || !text) return;

  const summary = getSummary();
  dot.dataset.state = summary;

  const downs = SOURCES.filter((source) => state[source].status === "down");
  if (summary === "ok") {
    text.textContent = "All services online";
    return;
  }
  if (downs.length) {
    text.textContent = `Issue: ${downs.join(", ")}`;
    return;
  }

  const recent = SOURCES.map((source) => `${source} ${relativeAge(state[source].ts)}`).join(" · ");
  text.textContent = `Syncing: ${recent}`;
}

export function markConnectorStatus(source, status) {
  if (!state[source]) return;
  state[source] = { status, ts: Date.now() };
  render();
}

export function initConnectionHealth() {
  render();
  on("ha:connected", () => markConnectorStatus("ha", "ok"));
  on("ha:disconnected", () => markConnectorStatus("ha", "down"));
}
