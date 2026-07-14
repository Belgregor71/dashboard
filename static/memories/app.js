// Memory Studio — the household authors memory entries by picking Immich photos,
// instead of hand-editing data/memories/*.json. Talks only to the dashboard's own
// server (Immich key stays server-side). Vanilla, no build step: served straight
// from static/memories/ so it can never affect the 24/7 kiosk bundle.

const $ = (id) => document.getElementById(id);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Southern Hemisphere (Brisbane) — the seasons the memory engine scores against.
function seasonForMonth(m /* 1-12 */) {
  if (m === 12 || m === 1 || m === 2) return "summer";
  if (m >= 3 && m <= 5) return "autumn";
  if (m >= 6 && m <= 8) return "winter";
  return "spring";
}

const SEASONS = ["summer", "autumn", "winter", "spring"];
const MOODS = [
  { tag: "wistful", label: "wistful · rainy days" },
  { tag: "grey", label: "grey · cloudy days" },
  { tag: "bright", label: "bright · clear days" }
];
const DAYS = ["weekend", "weekday", "holiday"];

// selection: assetId -> localDateTime (string|null)
const selected = new Map();
let sensitivity = "normal";

// ── toast ──────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2600);
}

// ── browse ─────────────────────────────────────────────────────
function initPickers() {
  const monthSel = $("month");
  MONTHS.forEach((name, i) => monthSel.add(new Option(name, String(i + 1))));
  const now = new Date();
  monthSel.value = String(now.getMonth() + 1);

  const yearSel = $("year");
  for (let y = now.getFullYear(); y >= 1950; y--) yearSel.add(new Option(String(y), String(y)));
  yearSel.value = String(now.getFullYear());
}

function monthWindow(year, month /* 1-12 */) {
  const pad = (n) => String(n).padStart(2, "0");
  const after = `${year}-${pad(month)}-01T00:00:00.000Z`;
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const before = `${nextY}-${pad(nextM)}-01T00:00:00.000Z`;
  return { after, before };
}

async function loadMonth() {
  const year = Number($("year").value);
  const month = Number($("month").value);
  const grid = $("grid");
  const empty = $("gridEmpty");
  grid.innerHTML = "";
  empty.style.display = "block";
  empty.textContent = "Loading…";

  const { after, before } = monthWindow(year, month);
  let assets = [];
  try {
    const res = await fetch(`/api/immich/browse?after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}`);
    const data = await res.json();
    assets = Array.isArray(data.assets) ? data.assets : [];
  } catch {
    empty.textContent = "Couldn't reach the photo library.";
    return;
  }

  if (assets.length === 0) {
    empty.textContent = `No photos found in ${MONTHS[month - 1]} ${year}.`;
    return;
  }
  empty.style.display = "none";

  for (const a of assets) {
    const div = document.createElement("div");
    div.className = "thumb" + (selected.has(a.id) ? " sel" : "");
    div.dataset.id = a.id;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = `/api/immich/asset/${encodeURIComponent(a.id)}/thumb`;
    img.alt = a.localDateTime || "";
    div.appendChild(img);
    div.addEventListener("click", () => toggleSelect(a, div));
    grid.appendChild(div);
  }
}

function toggleSelect(asset, div) {
  if (selected.has(asset.id)) selected.delete(asset.id);
  else selected.set(asset.id, asset.localDateTime || null);
  div.classList.toggle("sel");
  syncEditor();
}

// ── editor ─────────────────────────────────────────────────────
function buildChips() {
  const seasons = $("seasons");
  SEASONS.forEach((s) => seasons.appendChild(makeChip(s, s, "season", true)));
  const moods = $("moods");
  MOODS.forEach((m) => moods.appendChild(makeChip(m.tag, m.label, "mood", false)));
  const days = $("days");
  DAYS.forEach((d) => days.appendChild(makeChip(d, d, "day", false)));
}

// `single` groups behave like radios (season); others toggle freely.
function makeChip(tag, label, group, single) {
  const el = document.createElement("span");
  el.className = "chip " + group;
  el.dataset.tag = tag;
  el.dataset.group = group;
  el.textContent = label;
  el.addEventListener("click", () => {
    if (single) {
      el.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
      el.classList.add("on");
    } else {
      el.classList.toggle("on");
    }
  });
  return el;
}

function selectSeason(season) {
  $("seasons").querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("on", c.dataset.tag === season);
  });
}

function collectTags() {
  const tags = [];
  document.querySelectorAll("#seasons .chip.on, #moods .chip.on, #days .chip.on")
    .forEach((c) => tags.push(c.dataset.tag));
  return tags;
}

function syncEditor() {
  const n = selected.size;
  $("selCount").textContent = n ? `— ${n} photo${n === 1 ? "" : "s"} selected` : "";
  const has = n > 0;
  $("editor").classList.toggle("hidden", !has);
  $("editorEmpty").style.display = has ? "none" : "block";
  if (!has) return;

  // Prefill the date + season from the first selected photo's taken-date.
  const firstDate = [...selected.values()].find(Boolean);
  if (firstDate) {
    const iso = String(firstDate).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      if (!$("date").value) $("date").value = iso;
      const m = Number(iso.slice(5, 7));
      if (!$("seasons").querySelector(".chip.on")) selectSeason(seasonForMonth(m));
    }
  }
}

function updateCaption() {
  const title = $("title").value.trim();
  const el = $("captionPreview");
  if (sensitivity === "tender") {
    el.textContent = "Tender — shown wordless, no caption.";
  } else {
    el.textContent = title ? `On this day — ${title}.` : "";
  }
}

function setSensitivity(s) {
  sensitivity = s;
  $("sensNormal").classList.toggle("on", s === "normal");
  $("sensTender").classList.toggle("on", s === "tender");
  $("tenderNote").classList.toggle("show", s === "tender");
  if (s === "tender" && Number($("cooldown").value) < 12) $("cooldown").value = 12;
  updateCaption();
}

function clearEditor() {
  selected.clear();
  document.querySelectorAll(".thumb.sel").forEach((t) => t.classList.remove("sel"));
  $("title").value = "";
  $("date").value = "";
  $("cooldown").value = "6";
  $("recurring").checked = false;
  $("tenderConfirm").checked = false;
  document.querySelectorAll(".chip.on").forEach((c) => c.classList.remove("on"));
  setSensitivity("normal");
  syncEditor();
}

async function save() {
  const title = $("title").value.trim();
  if (!title) return toast("Give it a title first.", true);
  if (selected.size === 0) return toast("Select at least one photo.", true);
  if (sensitivity === "tender" && !$("tenderConfirm").checked) {
    return toast("Confirm the house is ready for the tender memory.", true);
  }

  const payload = {
    title,
    kind: $("kind").value,
    tags: collectTags(),
    photos: [...selected.keys()].map((id) => ({ immich: id })),
    sensitivity,
    cooldownMonths: Number($("cooldown").value) || undefined
  };
  if ($("recurring").checked && $("date").value) {
    const [, mm, dd] = $("date").value.split("-");
    payload.recurring = { month: Number(mm), day: Number(dd) };
  } else if ($("date").value) {
    payload.date = $("date").value;
  }

  const btn = $("save");
  btn.disabled = true;
  try {
    const res = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "save failed");
    toast("Memory saved.");
    clearEditor();
    loadSaved();
  } catch (e) {
    toast(e.message || "Couldn't save.", true);
  } finally {
    btn.disabled = false;
  }
}

// ── saved list ─────────────────────────────────────────────────
function photoThumb(entry) {
  const p = Array.isArray(entry.photos) ? entry.photos[0] : null;
  if (p && typeof p === "object" && p.immich) return `/api/immich/asset/${encodeURIComponent(p.immich)}/thumb`;
  if (typeof p === "string") return /^(https?:|\/)/.test(p) ? p : `/photos/${p}`;
  return "";
}

async function loadSaved() {
  const wrap = $("saved");
  let memories = [];
  try {
    const res = await fetch("/api/memories");
    const data = await res.json();
    memories = Array.isArray(data.memories) ? data.memories : [];
  } catch { /* leave empty */ }

  // The Studio only writes to authored.json; skip the client-generated on-this-day id.
  memories = memories.filter((m) => m && m.id && !String(m.id).startsWith("immich-otd:"));
  $("savedCount").textContent = memories.length ? `— ${memories.length}` : "";

  if (memories.length === 0) {
    wrap.innerHTML = '<div class="empty">No saved memories yet.</div>';
    return;
  }

  wrap.innerHTML = "";
  for (const m of memories) {
    const tender = m.sensitivity === "tender";
    const row = document.createElement("div");
    row.className = "entry";
    const when = m.recurring ? `every ${m.recurring.day}/${m.recurring.month}` : (m.date || "any day that fits");
    const tags = Array.isArray(m.tags) && m.tags.length ? m.tags.join(" · ") : "";
    row.innerHTML = `
      <img loading="lazy" src="${photoThumb(m)}" alt="" />
      <div class="meta">
        <b>${escapeHtml(m.title || m.id)}</b>
        <span class="badge${tender ? " tender" : ""}">${tender ? "tender" : (m.kind || "memory")}</span>
        <small>${escapeHtml(when)}${tags ? " · " + escapeHtml(tags) : ""}</small>
      </div>
      <button class="danger" data-id="${escapeHtml(m.id)}">Remove</button>`;
    row.querySelector("button").addEventListener("click", () => removeEntry(m.id, m.title));
    wrap.appendChild(row);
  }
}

async function removeEntry(id, title) {
  if (!confirm(`Remove "${title || id}"?`)) return;
  try {
    const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "delete failed");
    toast("Removed.");
    loadSaved();
  } catch (e) {
    toast(e.message === "no authored memory with that id" ? "Only Studio-made memories can be removed here." : "Couldn't remove.", true);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── wire up ────────────────────────────────────────────────────
initPickers();
buildChips();
$("load").addEventListener("click", loadMonth);
$("save").addEventListener("click", save);
$("cancel").addEventListener("click", clearEditor);
$("title").addEventListener("input", updateCaption);
$("sensNormal").addEventListener("click", () => setSensitivity("normal"));
$("sensTender").addEventListener("click", () => setSensitivity("tender"));
loadSaved();
