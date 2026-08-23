import { computeFocus } from "../services/focusEngine.js";
import { getBomWarnings } from "../services/weather/bom.js";
import { getAllEntities } from "../services/homeAssistant/state.js";
import { getCurrentInsight, initInsightEngine } from "../services/insightEngine.js";
import { initAttentionEngine, getSelection } from "../services/attentionEngine.js";
import { collectSources, cameraSnapshotUrl, robotAttentionFrom } from "../services/candidateSources.js";
import { getLastCameraTrigger } from "./cameraTiles.js";
import { getMode } from "../core/presence.js";
import { on } from "../core/eventBus.js";
import { attentionWeights } from "../core/routineRuntime.js";

const TICK_MS = 30_000;
const CONCIERGE_MIN_INTERVAL_MS = 20 * 60 * 1000;
const STACK_FADE_MS = 700; // > CSS opacity transition; never clear on transitionend (hidden node)

const HERO_TIER_A_MAX = 16; // ≤16 chars → headline
const HERO_TIER_B_MAX = 40; // 17–40 chars → standard (the default)

let conciergeText = null;
let conciergeFetchedAt = 0;
let attentionOn = false;
// Tier-1a (features.stackCards, requires leanInStack): the rich spec card —
// title/sub/meta slots, hero-glass top card, severity stripe, resting note.
let stackCardsOn = false;
let heroTypeOn = false;
let leanInOn = false;
let bareHeroOn = false;
let mediaCandidateOn = false;
let foldHomeTilesOn = false;
let cameraCandidateOn = false;
let robotCandidateOn = false;
let stackClearTimer = null;
let lastSelection = { hero: null, stack: [], queue: [] };

// Study 02 — length-responsive hero type. Character count picks the tier:
// short lines go big, long lines step down. 41+ chars all land on tier C
// (the legibility floor) — the temperament trims copy before it reaches here.
function heroTier(text) {
  const n = (text || "").trim().length;
  if (n <= HERO_TIER_A_MAX) return "a";
  if (n <= HERO_TIER_B_MAX) return "b";
  return "c";
}

function applyHeroTier(hero, text) {
  const tier = heroTier(text);
  hero.classList.remove("focus-hero--tier-a", "focus-hero--tier-b", "focus-hero--tier-c");
  hero.classList.add(`focus-hero--tier-${tier}`);
}

function isPanelActive(panelId) {
  const panel = document.getElementById(panelId);
  return Boolean(panel) && !panel.classList.contains("is-collapsed") && !panel.classList.contains("is-hidden");
}

// The active media player's "source — title", or null. Reads the same panels the
// screensaver's ambient line does; feeds the now-playing attention candidate when
// features.mediaCandidate folds the standalone panel into the queue.
// The active HA media player's { text, image }, or null. image = the album/movie
// art (entity_picture) so the folded candidate can show the real thumbnail.
function readNowPlaying() {
  for (const id of ["media-panel-1", "media-panel-2"]) {
    if (!isPanelActive(id)) continue;
    const panel = document.getElementById(id);
    const source = panel.querySelector(".media-panel__source")?.textContent?.trim();
    const title = panel.querySelector(".media-panel__title")?.textContent?.trim();
    if (!title) continue;
    const image = panel.querySelector(".media-panel__image")?.getAttribute("src")?.trim() || null;
    return { text: [source, title].filter(Boolean).join(" — "), image, title, sub: source || null };
  }
  return null;
}

// The first active Plex stream's { text, image }, from the separate Plex panel
// (#plex-status tiles carry the poster as a background-image).
function readPlex() {
  if (!isPanelActive("server-status-panel")) return null;
  const tile = document.querySelector("#plex-status .plex-status__tile");
  if (!tile) return null;
  const title = tile.querySelector(".plex-status__title")?.textContent?.trim();
  if (!title) return null;
  const bg = tile.style.backgroundImage || "";
  const m = /url\(["']?(.*?)["']?\)/.exec(bg);
  return { text: title, image: m ? m[1] : null };
}

// Tonight's dinner name from the menu tile, or null. Feeds the tonights-menu
// attention candidate when features.foldHomeTiles folds the tile into the queue.
function readTonightsMenu() {
  if (!isPanelActive("menu-tile")) return null;
  return document.getElementById("menu-tile-name")?.textContent?.trim() || null;
}

// The most recent camera trigger { name, at, label } from the cameraTiles module
// state, or null. Feeds the camera-trigger attention candidate when
// features.cameraCandidate folds the old last-trigger pill into the queue. Matches
// the pill's time format so the copy reads the same, just in the stack now.
function readCameraTrigger() {
  const t = getLastCameraTrigger();
  if (!t?.cameraName || !t?.timestamp) return null;
  const time = new Date(t.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return {
    name: t.cameraName,
    at: t.timestamp,
    label: `Last triggered ${time}`,
    // The card shows the triggered camera's own frame instead of a generic glyph.
    image: cameraSnapshotUrl({ cameraId: t.cameraId, at: t.timestamp })
  };
}

function readState() {
  // Now-playing (HA media + Plex) → attention candidates. Read only when the flag
  // is on, so flag-off carries no candidate (byte-identical) and the panels keep
  // showing standalone.
  const nowPlaying = mediaCandidateOn ? readNowPlaying() : null;
  const plex = mediaCandidateOn ? readPlex() : null;
  const menuName = foldHomeTilesOn ? readTonightsMenu() : null;
  const cameraTrigger = cameraCandidateOn ? readCameraTrigger() : null;
  // Flag-off reads nothing, so the queue carries no robot candidate at all.
  const robot = robotCandidateOn ? robotAttentionFrom(getAllEntities()) : null;
  return {
    bomWarning: getBomWarnings(getAllEntities()).summary || null,
    robotProblems: robot?.problems ?? null,
    robotConsumables: robot?.consumables ?? null,
    insight: getCurrentInsight(),
    weatherCondition: document.getElementById("current-conditions")?.textContent?.trim() || "",
    weatherTemp: document.getElementById("current-temp")?.textContent?.trim() || "",
    commuteActive: isPanelActive("commute-panel"),
    commuteText: [
      document.getElementById("commute-greg")?.textContent?.trim(),
      document.getElementById("commute-brett")?.textContent?.trim()
    ].filter(Boolean).join(" · "),
    nextEventActive: isPanelActive("next-event-panel"),
    nextEventText: [
      document.getElementById("next-event-name")?.textContent?.trim(),
      document.getElementById("next-event-meta")?.textContent?.trim()
    ].filter(Boolean).join(" · "),
    // Rich-card slots (stackCards): the panel already keeps name and the relative
    // line apart. The name carries its category emoji — strip it; the card's icon
    // slot owns the glyph.
    nextEventTitle: (document.getElementById("next-event-name")?.textContent?.trim() || "")
      .replace(/^\p{Extended_Pictographic}️?\s*/u, "") || null,
    nextEventSub: document.getElementById("next-event-meta")?.textContent?.trim() || null,
    nowPlayingActive: Boolean(nowPlaying),
    nowPlayingText: nowPlaying?.text ?? null,
    nowPlayingImage: nowPlaying?.image ?? null,
    nowPlayingTitle: nowPlaying?.title ?? null,
    nowPlayingSub: nowPlaying?.sub ?? null,
    plexActive: Boolean(plex),
    plexText: plex?.text ?? null,
    plexImage: plex?.image ?? null,
    menuActive: Boolean(menuName),
    menuName,
    cameraTriggerName: cameraTrigger?.name ?? null,
    cameraTriggerAt: cameraTrigger?.at ?? null,
    cameraTriggerLabel: cameraTrigger?.label ?? null,
    cameraTriggerImage: cameraTrigger?.image ?? null,
    /* ⚠ SHAPE PARITY, and deliberately always empty. houseSnapshot's contract
       is that collectSources() cannot tell the two readers apart, and it grew
       `mediaRooms` on 2026-08-23 for V3's per-room media surface. This surface
       scrapes two rendered panels and has no per-room concept to scrape, so the
       honest answer is "no rooms" rather than a guess — the media candidates
       then carry `media: null` here, which is exactly what they carried before
       the field existed. tests/house-snapshot.spec.js pins the key sets equal. */
    mediaRooms: []
  };
}

// Real weather for the concierge line — the DOM condition label alone
// ("Clear") gave the model so little that it invented forecasts.
async function fetchWeatherLine() {
  try {
    const res = await fetch("/api/weather/now", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data  = await res.json();
    const parts = [];
    if (data?.now?.temp_c != null) parts.push(`${Math.round(data.now.temp_c)}°`);
    const label = data?.now?.condition?.label;
    if (label && label !== "Unavailable") parts.push(label);
    if (data?.day?.low_c != null && data?.day?.high_c != null) {
      parts.push(`${Math.round(data.day.low_c)}° to ${Math.round(data.day.high_c)}° today`);
    }
    return parts.length ? parts.join(", ") : null;
  } catch { return null; }
}

async function maybeFetchConcierge(weatherCondition) {
  if (Date.now() - conciergeFetchedAt < CONCIERGE_MIN_INTERVAL_MS) return;
  conciergeFetchedAt = Date.now(); // claim the slot before awaiting, avoids overlapping fetches
  try {
    const weather = (await fetchWeatherLine()) ?? weatherCondition ?? null;
    const res = await fetch("/api/ai/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "concierge",
        time: new Date().toLocaleString("en-AU", { weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }),
        weather
      }),
      signal: AbortSignal.timeout(8_000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.summary) conciergeText = data.summary;
    }
  } catch { /* non-fatal — hero just stays hidden */ }
}

function heroEls() {
  const hero = document.getElementById("focus-hero");
  const iconEl = document.getElementById("focus-hero-icon");
  const textEl = document.getElementById("focus-hero-text");
  if (!hero || !iconEl || !textEl) return null;
  return { hero, iconEl, textEl };
}

function showHero(els, icon, text, { concierge = false, image = null } = {}) {
  // A media/plex candidate carries its artwork; render it in the glyph slot as a
  // thumbnail (resized to fit via CSS) instead of the emoji. Else the plain glyph.
  if (image) {
    const img = document.createElement("img");
    img.className = "focus-hero__art";
    img.src = image;
    img.alt = "";
    els.iconEl.replaceChildren(img);
  } else {
    els.iconEl.textContent = icon;
  }
  els.textEl.textContent = text;
  if (heroTypeOn) applyHeroTier(els.hero, text);
  // WP-C: mark the idle concierge fallback so the un-chromed hero can render it
  // matte (no glyph glow, lower ink). Flag-off adds no class → byte-identical.
  if (bareHeroOn) els.hero.classList.toggle("concierge", concierge === true);
  els.hero.classList.toggle("focus-hero--art", Boolean(image));
  els.hero.classList.remove("is-hidden");
}

function hideHero(els) {
  els.hero.classList.add("is-hidden");
}

// ── Lean-in stack (Mode 2 DWELL) ──────────────────────────────
// Opacity-fade only (transform breaks fixed descendants) with a setTimeout
// teardown — transitionend never fires while the node is hidden. See the
// 2026-07 leak-audit memory.
function renderStack(items, { restingCount = 0 } = {}) {
  const stackEl = document.getElementById("focus-stack");
  if (!stackEl) return;

  if (!items.length) {
    stackEl.classList.add("is-hidden");
    clearTimeout(stackClearTimer);
    stackClearTimer = setTimeout(() => stackEl.replaceChildren(), STACK_FADE_MS);
    return;
  }

  clearTimeout(stackClearTimer);
  stackEl.replaceChildren(
    ...items.map((c, idx) => {
      const row = document.createElement("div");
      row.className = "focus-stack__item";
      // Tier-1a (stackCards): the top card takes the brighter hero-glass variant,
      // and an interrupt candidate earns the severity stripe (never a coloured card).
      if (stackCardsOn && idx === 0) row.classList.add("focus-stack__item--hero-glass");
      if (stackCardsOn && c.interrupt) row.classList.add("focus-stack__item--severe");
      const icon = document.createElement("span");
      icon.className = "focus-stack__icon";
      // Media/plex candidates show their artwork as a thumbnail (resized to fit
      // via CSS); everything else keeps the emoji glyph.
      if (c.image) {
        const img = document.createElement("img");
        img.className = "focus-stack__thumb";
        img.src = c.image;
        img.alt = "";
        icon.replaceChildren(img);
      } else {
        icon.textContent = c.icon;
      }
      if (!stackCardsOn) {
        const text = document.createElement("span");
        text.className = "focus-stack__text";
        text.textContent = c.text;
        row.append(icon, text);
        return row;
      }
      // Rich card: title (the candidate's structured title, or its text — one
      // type system either way) + optional sub, + an optional right meta block.
      const bodyEl = document.createElement("span");
      bodyEl.className = "focus-stack__body";
      const titleEl = document.createElement("span");
      titleEl.className = "focus-stack__title";
      titleEl.textContent = c.title || c.text;
      bodyEl.append(titleEl);
      if (c.sub) {
        const subEl = document.createElement("span");
        subEl.className = "focus-stack__sub";
        subEl.textContent = c.sub;
        bodyEl.append(subEl);
      }
      row.append(icon, bodyEl);
      if (c.meta) {
        const metaEl = document.createElement("span");
        metaEl.className = "focus-stack__meta";
        const valueEl = document.createElement("span");
        valueEl.className = "focus-stack__meta-value";
        valueEl.textContent = c.meta;
        metaEl.append(valueEl);
        if (c.metaLabel) {
          const labelEl = document.createElement("span");
          labelEl.className = "focus-stack__meta-label";
          labelEl.textContent = c.metaLabel;
          metaEl.append(labelEl);
        }
        row.append(metaEl);
      }
      return row;
    })
  );
  // The mono resting note — how much of the queue stays below the fold. Rendered
  // as a stack child so the replaceChildren teardown stays symmetric.
  if (stackCardsOn && restingCount > 0) {
    const note = document.createElement("div");
    note.className = "focus-stack__note";
    note.textContent = `+ ${restingCount} more candidate${restingCount === 1 ? "" : "s"} resting below the fold`;
    stackEl.append(note);
  }
  stackEl.classList.remove("is-hidden");
}

// ── Hero/stack collision guard ────────────────────────────────
// Under bareHero the hero is fixed-centred (50% + --hero-offset) and the stack is
// fixed to the bottom, on independent anchors — so a two-line hero over a full
// stack overlaps (measured 104px at 1920x1080: hero 522–798, stack 694–972).
// Measure both after each render and lift the hero by exactly the shortfall,
// clamped so it never climbs into the bare top row. One synchronous measure per
// update tick — no listener, no loop, nothing animated.
const HERO_STACK_GAP = 24; // breathing room between the line and the top card
const HERO_MIN_TOP = 180;  // keep clear of the clock / weather row

function syncHeroLift(hero) {
  if (!bareHeroOn) return;
  document.body.style.setProperty("--hero-lift", "0px"); // measure unlifted
  const stackEl = document.getElementById("focus-stack");
  if (hero.classList.contains("is-hidden")) return;
  if (!stackEl || stackEl.classList.contains("is-hidden") || !stackEl.firstChild) return;

  const h = hero.getBoundingClientRect();
  const s = stackEl.getBoundingClientRect();
  const shortfall = h.bottom + HERO_STACK_GAP - s.top;
  if (shortfall <= 0) return;
  const lift = Math.min(shortfall, Math.max(0, h.top - HERO_MIN_TOP));
  if (lift > 0) document.body.style.setProperty("--hero-lift", `${Math.round(lift)}px`);
}

function updateAttention(state, els) {
  const mode = getMode();
  const sources = collectSources(state);
  // Phase 8 — learned per-source nudges tilt the ranking ({} when off → unchanged).
  const sel = getSelection({ sources, now: new Date(), mode, weights: attentionWeights() });
  lastSelection = sel;

  if (!sel.hero) {
    // Concierge fallback only when the display is awake — never in AMBIENT/VOICE.
    if (mode === "glance" || mode === "dwell") {
      void maybeFetchConcierge(state.weatherCondition);
      if (conciergeText) showHero(els, "✨", conciergeText, { concierge: true });
      else hideHero(els);
    } else {
      hideHero(els);
    }
    // Stack-only candidates (now-playing / menu) still ride the lean-in stack
    // even with no scored hero above them — but only on DWELL (GLANCE shows just
    // the hero line, no cards).
    const items = mode === "dwell" ? sel.stack : [];
    renderStack(items, { restingCount: Math.max(0, (sel.queue?.length ?? 0) - items.length) });
    return;
  }

  showHero(els, sel.hero.icon, sel.hero.text, { image: sel.hero.image });
  const items = sel.stack.slice(1); // items 2..N — the hero already owns slot 1
  // Resting note: everything ranked but not shown (the hero + the visible cards).
  renderStack(items, { restingCount: Math.max(0, (sel.queue?.length ?? 0) - 1 - items.length) });
}

function update() {
  const els = heroEls();
  if (!els) return;

  const state = readState();

  if (attentionOn) {
    updateAttention(state, els);
    syncHeroLift(els.hero); // after the hero + stack have both rendered
    return;
  }

  // ── flag-off path: unchanged pre-Phase-2 behaviour ──
  const focus = computeFocus(state);

  if (!focus) {
    void maybeFetchConcierge(state.weatherCondition);
    if (!conciergeText) {
      hideHero(els);
      return;
    }
    showHero(els, "✨", conciergeText, { concierge: true });
    return;
  }

  showHero(els, focus.icon, focus.text);
}

export function initFocusHero({ attentionEnabled = false, heroTypeEnabled = false, leanInStackEnabled = false, stackCardsEnabled = false, bareHeroEnabled = false, mediaCandidateEnabled = false, foldHomeTilesEnabled = false, cameraCandidateEnabled = false, robotCandidateEnabled = false } = {}) {
  attentionOn = attentionEnabled === true;
  heroTypeOn = heroTypeEnabled === true;
  leanInOn = leanInStackEnabled === true;
  stackCardsOn = leanInOn && stackCardsEnabled === true; // rides on the glass
  bareHeroOn = bareHeroEnabled === true;
  mediaCandidateOn = mediaCandidateEnabled === true;
  foldHomeTilesOn = foldHomeTilesEnabled === true;
  cameraCandidateOn = cameraCandidateEnabled === true;
  robotCandidateOn = robotCandidateEnabled === true;

  // Study 02 — mark the feature on so the length-responsive CSS engages, and
  // expose a probe for the on-Pi 3–4 m legibility check. Flag-off: no class,
  // no hook → byte-identical.
  if (heroTypeOn) {
    const els = heroEls();
    if (els) els.hero.classList.add("hero-type");
    window.__heroType = () => {
      const t = document.getElementById("focus-hero-text")?.textContent || "";
      return { enabled: true, len: t.trim().length, tier: heroTier(t), text: t };
    };
  }

  // Study 01 (WP2) — mark the stack so the full-glass CSS engages on DWELL only.
  // Flag-off: no class → flat cards, byte-identical. The reveal/teardown path
  // (renderStack) is unchanged; this only restyles the cards it produces.
  if (leanInOn) {
    const stackEl = document.getElementById("focus-stack");
    if (stackEl) stackEl.classList.add("lean-in-glass");
    // Tier-1a — the rich spec card treatment layers on the glass.
    if (stackCardsOn && stackEl) stackEl.classList.add("stack-cards");
    window.__leanInStack = () => {
      const item = document.querySelector("#focus-stack .focus-stack__item");
      const cs = item ? getComputedStyle(item) : null;
      return {
        enabled: true,
        marked: Boolean(document.getElementById("focus-stack")?.classList.contains("lean-in-glass")),
        items: document.querySelectorAll("#focus-stack .focus-stack__item").length,
        backdropFilter: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
        boxShadow: cs ? cs.boxShadow : null
      };
    };
  }

  if (attentionOn) {
    initAttentionEngine();
    on("presence:changed", update); // reveal/collapse the stack immediately on mode change
    window.__attention = () => ({ mode: getMode(), ...lastSelection });
  } else {
    initInsightEngine();
  }

  update();
  setInterval(update, TICK_MS);
}
