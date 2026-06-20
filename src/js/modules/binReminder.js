import { emit } from "../core/eventBus.js";

const BIN_META = {
  red:    { label: "General",   color: "#c0392b" },
  yellow: { label: "Recycling", color: "#f1c40f" },
  green:  { label: "Organics",  color: "#27ae60" },
};

const REFRESH_H = 60 * 60 * 1000; // re-check every hour

let lastData = null;

export function getLastBinData() {
  return lastData;
}

function render(data) {
  lastData = data;
  const binsText = Array.isArray(data?.bins)
    ? data.bins.map(b => BIN_META[b]?.label ?? b).join(" + ")
    : "";
  emit("bins:updated", { ...data, binsText });
}

async function refresh() {
  try {
    const res  = await fetch("/api/bins");
    const data = await res.json();
    render(data);
  } catch {
    // Non-fatal — bin reminder just won't show
  }
}

// Schedule a refresh at the next eve threshold (5 pm today) or midnight
function scheduleNextRefresh() {
  const now  = new Date();
  const next = new Date(now);

  if (now.getHours() < 17) {
    // Refresh at 17:00 today (eve reminder activates)
    next.setHours(17, 0, 0, 0);
  } else {
    // Refresh at midnight (collection day starts)
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  }

  const delay = Math.max(next - now, 60_000);
  setTimeout(() => { refresh(); scheduleNextRefresh(); }, delay);
}

export async function initBinReminder() {
  await refresh();
  setInterval(refresh, REFRESH_H);
  scheduleNextRefresh();
}
