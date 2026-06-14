const BIN_META = {
  red:    { label: "General",   color: "#c0392b" },
  yellow: { label: "Recycling", color: "#f1c40f" },
  green:  { label: "Organics",  color: "#27ae60" },
};

const ITEM_ID   = "bin-reminder-item";
const REFRESH_H = 60 * 60 * 1000; // re-check every hour

let lastData = null;

export function getLastBinData() {
  return lastData;
}

function buildItem(data) {
  const li = document.createElement("li");
  li.id = ITEM_ID;
  li.className = "bin-reminder";

  const dotsHtml = data.bins
    .map(b => {
      const meta = BIN_META[b] ?? { label: b, color: "#888" };
      return `
        <div class="bin-dot">
          <div class="bin-dot__circle" style="background:${meta.color}"></div>
          <span class="bin-dot__label">${meta.label}</span>
        </div>`;
    })
    .join("");

  li.innerHTML = `
    <div class="bin-reminder__header">
      <span class="bin-reminder__icon">🗑️</span>
      <span class="bin-reminder__title">${data.label}</span>
    </div>
    <div class="bin-reminder__dots">${dotsHtml}</div>
  `;
  return li;
}

function render(data) {
  lastData = data;
  const list = document.getElementById("today-list");
  if (!list) return;

  const existing = document.getElementById(ITEM_ID);

  if (!data?.due) {
    existing?.remove();
    return;
  }

  if (existing) {
    existing.replaceWith(buildItem(data));
  } else {
    list.prepend(buildItem(data));
  }
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
