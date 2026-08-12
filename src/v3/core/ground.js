/* ═══════════════════════════════════════════════════════════════════════════
   THE GROUND — depth 0's photograph.

   Behind `groundMemories` this is ON THIS DAY: the same date across every year
   in the library, drawn once per local day and walked in shuffled order, with a
   caption naming who and where and when.

   ⚠ THAT REVERSES THIS FILE'S ORIGINAL RULE, so the old reasoning is kept here
   rather than deleted. It said: a rotation timer's only cause would be the
   passage of time, and time passing is explicitly NOT a cause (DESIGN_SYSTEM.md
   §5.1), so one photograph was held for the whole day and replaced only at the
   day boundary. What that missed is that a day spent with a picture you don't
   much like has no way out, and a wall nobody enjoys looking at fails the only
   test that matters. The rule survives in an amended form: the cause is not
   "time passed" but "this is a different memory from the same date", and the
   caption is what makes that cause visible to the room. Flag off restores the
   original behaviour exactly — one random photograph, held for the day.

   ⚠ THE FAILURE MODE THIS FILE IS SHAPED AROUND. The photograph comes off a NAS
   that sleeps, and this page runs for weeks between reloads. An <img> that fires
   NEITHER load NOR error is therefore not a hypothetical: it is the normal
   behaviour of a sleeping Synology, and a latch left holding on that path is
   permanent. Every load below has exactly one terminal path, taken once, with a
   stall timer as the third way out — and every failure leaves the day key unset
   on purpose, because an unset day key is precisely what tells the tick to come
   back for it. The incumbent surface shipped without that and spent whole days
   with an empty ground and no retry.
   ═══════════════════════════════════════════════════════════════════════════ */

/* 30s is far beyond a LAN thumbnail and far under the tick that would retry it. */
const STALL_MS = 30 * 1000;

/* How often we ask whether the calendar day has turned. Cheap, init-once, and
   the only timer this module owns. */
const CHECK_MS = 10 * 60 * 1000;

/* The day-boundary settle. A minute, matching the incumbent's dissolve: the one
   photographic change in a day should not be an event, it should be something
   you notice happened rather than something you watch happen. */
const DISSOLVE_MS = 60 * 1000;
const CLEANUP_BUFFER_MS = 2000;

let host = null;                 // the .photo container
let current = null;              // { img, assetId, dayKey }
let inFlight = false;
let checkTimer = null;
let onPhoto = () => {};

/* Local date key, never toISOString: the UTC date disagrees with "today" for
   ten hours of every Brisbane day, which would move the change to mid-morning. */
const localDayKey = () => new Date().toDateString();

const thumbUrl = (id) => `/api/immich/asset/${encodeURIComponent(id)}/thumb`;

/** One-shot terminal path: whichever of load / error / stall arrives first wins,
 *  and the other two become no-ops. */
function oneShot() {
  let done = false;
  let stall = null;
  const take = (fn) => () => {
    if (done) return;
    done = true;
    clearTimeout(stall);
    stall = null;
    fn();
  };
  return {
    take,
    arm(fn, ms = STALL_MS) { stall = setTimeout(take(fn), ms); }
  };
}

/**
 * Pick the next photograph. Asks for two and prefers one that is not already on
 * the glass: the server caches `rnd:N` for ten minutes, which makes drawing the
 * same asset twice in a row far likelier than chance, and spending the day's
 * one settle on a visual no-op is worse than not settling at all.
 */
/* ── On this day ────────────────────────────────────────────────────────────
   One photograph a day was deliberate and it was wrong in practice: a day spent
   with a picture you don't much like has no way out, and the wall stops being
   looked at. `/api/immich/on-this-day` returns the same date across every year
   in the library — today, 116 photographs from 2011 to 2023 — already carrying
   city, people and the screenshot filter (`withExif` is requested, which is
   what makes `isScreenshot` able to see anything at all).

   The pool is drawn ONCE per local day and walked in shuffled order, so the
   ten-minute tick never re-fetches and a photograph cannot repeat until the
   whole day's set has been seen. Falls back to the old random endpoint on a
   date with no memories — some days have none, and a blank wall is worse. */
const MEMORIES_URL = "/api/immich/on-this-day";
const RANDOM_URL = "/api/immich/random?count=2";

let pool = [];
let poolCursor = 0;
let poolDayKey = null;

const memoriesEnabled = () => Boolean(globalThis.window?.CONFIG?.features?.groundMemories);

/** Fisher–Yates, so "next" is a walk rather than a repeated random draw. */
function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* Anything at least this wide fills a 1920x1080 panel with NO upscale, because
   object-fit cover matches the width and 1.78 is the panel's own aspect. */
const LANDSCAPE_MIN_ASPECT = 1.2;

/**
 * Landscape first, portrait after — each shuffled, and nothing discarded.
 *
 * 🔑 THIS, NOT THE RENDITION, IS THE SHARPNESS FIX. Measured on the live
 * library 2026-08-12: Immich caps previews at a 1920 LONG EDGE (the old comment
 * claiming ~1440px / ~47KB was wrong — they are 263KB), `?size=fullsize` 302s to
 * the same file, and `/original` is HEIC, which Chromium cannot render at all.
 * So no larger rendition exists to fetch. A LANDSCAPE preview already lands at
 * exactly 1.0 scale on this panel; a PORTRAIT one is upscaled 1.33x and cropped
 * to ~42% of its content. Portraits were always going to look worse, and no
 * change on the server side could have fixed that.
 *
 * They are ordered rather than filtered because a portrait photograph is still
 * a memory, and on a day whose set is mostly portraits a filter would empty the
 * wall. This way they are simply seen last. */
function orderByFit(list) {
  const landscape = list.filter((a) => (a.aspect ?? 0) >= LANDSCAPE_MIN_ASPECT);
  const rest = list.filter((a) => (a.aspect ?? 0) < LANDSCAPE_MIN_ASPECT);
  return [...shuffled(landscape), ...shuffled(rest)];
}

/**
 * The line under the photograph: who, where, when — omitting whatever the
 * library does not know, and returning "" when it knows nothing worth saying.
 * Pure, so a spec can pin every shape without a network or a DOM.
 */
export function captionFor(asset) {
  if (!asset) return "";
  const parts = [];

  /* ⚠ TRIM BEFORE FILTERING. Immich returns a person record with an empty or
     whitespace name for a detected-but-unnamed face, and `"  "` is truthy — a
     bare .filter(Boolean) puts a blank name on the wall followed by a stray
     separator. Caught by a spec, not by looking at it. */
  const people = (asset.people ?? [])
    .map((p) => String(p ?? "").trim())
    .filter(Boolean);
  // Two names read as a couple; beyond that the line becomes a list and stops
  // being glanceable, so it degrades to a count.
  if (people.length === 1) parts.push(people[0]);
  else if (people.length === 2) parts.push(`${people[0]} & ${people[1]}`);
  else if (people.length > 2) parts.push(`${people[0]} & ${people.length - 1} others`);

  // City alone is the useful grain — "Nudgee" says more than "Queensland,
  // Australia" to someone standing in Nudgee. Country only when it is the
  // only thing known, which is what makes a holiday photo still say something.
  if (asset.city) parts.push(asset.city);
  else if (asset.country) parts.push(asset.country);

  /* Strings only. The route returns an ISO `localDateTime`; anything else is a
     shape we do not understand, and slicing a number like 20230812 yields
     "2023" — a year that LOOKS right and was never actually parsed. */
  const raw = asset.localDateTime;
  const year = typeof raw === "string" ? raw.slice(0, 4) : "";
  if (/^\d{4}$/.test(year)) parts.push(year);

  return parts.join(" · ");
}

async function fetchPool() {
  try {
    const res = await fetch(MEMORIES_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    return ((await res.json()).assets ?? []).filter((a) => a?.id);
  } catch {
    return [];
  }
}

async function pickRandom(exclude) {
  try {
    const res = await fetch(RANDOM_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const list = ((await res.json()).assets ?? []).filter((a) => a?.id);
    return list.find((a) => a.id !== exclude) ?? list[0] ?? null;
  } catch {
    // Immich down or unreachable → no photograph, and the substrate carries
    // depth 0 on its own. The tick comes back in ten minutes.
    return null;
  }
}

/** @returns {Promise<object|null>} the whole asset, not just its id — the
 *  caption needs the people and the place that came down with it. */
async function pickAsset(exclude) {
  if (!memoriesEnabled()) return pickRandom(exclude);

  const today = localDayKey();
  if (poolDayKey !== today || poolCursor >= pool.length) {
    const fresh = await fetchPool();
    if (fresh.length) {
      pool = orderByFit(fresh);
      poolCursor = 0;
      poolDayKey = today;
    }
  }

  // A date with nothing in the library, or a fetch that failed: the old
  // behaviour is the fallback, never a blank wall.
  if (!pool.length || poolDayKey !== today) return pickRandom(exclude);

  let next = pool[poolCursor++];
  // Only matters when the day's set is a single photograph.
  if (next?.id === exclude && poolCursor < pool.length) next = pool[poolCursor++];
  return next ?? null;
}


/** The caption element is optional — a surface without one simply has no line. */
function paintCaption() {
  const el = document.getElementById("ground-caption");
  if (!el) return;
  const text = memoriesEnabled() ? captionFor(current?.asset) : "";
  el.textContent = text;
  el.dataset.blank = text ? "0" : "1";
}

/** The first photograph of the session. */
async function loadFirst(stallMs = STALL_MS) {
  if (inFlight || current) return false;
  const img = host?.querySelector("img");
  if (!img) return false;

  inFlight = true;
  let handedOff = false;
  try {
    const asset = await pickAsset(null);
    const assetId = asset?.id ?? null;
    if (!assetId) return false;

    const shot = oneShot();
    img.onload = shot.take(() => {
      img.dataset.shown = "1";
      current = { img, assetId, asset, dayKey: localDayKey() };
      paintCaption();
      inFlight = false;
      onPhoto(img, { transitioning: false });
    });
    // Both failure paths leave `current` null on purpose — that is what the
    // tick reads to know there is still no photograph.
    img.onerror = shot.take(() => { inFlight = false; });
    shot.arm(() => { inFlight = false; }, stallMs);

    img.decoding = "async";
    img.src = thumbUrl(assetId);
    handedOff = true;
    return true;
  } catch {
    return false;
  } finally {
    if (!handedOff) inFlight = false;
  }
}

/**
 * The day boundary. A second <img> fades in ON TOP of the old one, which stays
 * fully opaque underneath until the settle is over.
 *
 * ⚠ Cross-fading BOTH — new in, old out — would leave the pair at ~50% each in
 * the middle, and two half-transparent photographs do not add up to one opaque
 * one: the substrate shows through and the whole wall dips dark halfway through
 * the settle. Fading only the incoming layer is what makes the exchange
 * invisible.
 *
 * ⚠ Cleanup is a setTimeout, never transitionend. transitionend does not fire
 * while the element or any ancestor is display:none, and at depth 3 a subject
 * covers this layer entirely. That bug class has cost this house 709 zombie
 * wrappers and 230k detached nodes; V3 does not get to relearn it.
 */
async function dissolve(settleMs = DISSOLVE_MS, stallMs = STALL_MS) {
  if (inFlight || !current || !host) return false;
  inFlight = true;
  let handedOff = false;
  try {
    const asset = await pickAsset(current.assetId);
    const assetId = asset?.id ?? null;
    if (!assetId) return false;   // keep the photograph we have; retry next tick

    const old = current;
    const next = document.createElement("img");
    next.alt = "";
    next.decoding = "async";
    next.style.transition = `opacity ${settleMs}ms linear`;

    const shot = oneShot();
    const settle = () => {
      next.dataset.shown = "1";
      current = { img: next, assetId, asset, dayKey: localDayKey() };
      paintCaption();
      inFlight = false;

      // The incoming photograph's own opacity may be lower than the outgoing
      // one's. It may not be applied yet — for the length of the settle both
      // are on the glass, and the scrim has to protect the brighter of them.
      onPhoto(next, { transitioning: true });

      setTimeout(() => {
        old.img.remove();
        // #ground names whatever photograph is currently the ground. Carrying
        // the id across keeps that true for the life of the page, so nothing
        // that looks it up ever holds a detached node.
        next.id = old.img.id || "ground";
        onPhoto(next, { transitioning: false });
      }, settleMs + CLEANUP_BUFFER_MS);
    };

    next.onload = shot.take(settle);
    // A dead incoming photograph must not take the live one with it: drop the
    // half-built node and leave the day key as it was so the tick retries.
    next.onerror = shot.take(() => { next.remove(); inFlight = false; });
    shot.arm(() => { next.remove(); inFlight = false; }, stallMs);

    // Appended BEFORE the src so the element has rendered one frame at opacity
    // 0 — a node inserted already at its final state has nothing to transition
    // from and would cut rather than settle.
    host.append(next);
    next.src = thumbUrl(assetId);
    handedOff = true;
    return true;
  } catch {
    return false;
  } finally {
    if (!handedOff) inFlight = false;
  }
}

function tick() {
  if (!current) { void loadFirst(); return; }
  if (current.dayKey !== localDayKey()) { void dissolve(); return; }
  /* With memories on, the tick IS the rotation — no second timer. The cause is
     not "time passed": it is that this is a different memory from the same date,
     and the caption names it, so the room can see why the picture changed. */
  if (memoriesEnabled()) void dissolve();
}

/**
 * @param {HTMLImageElement} img  the #ground element from index.html
 * @param {{onPhoto?: (img: HTMLImageElement, meta: {transitioning: boolean}) => void}} opts
 *        Fired whenever the photograph on the glass changes — once on arrival
 *        and, across a day boundary, again when the settle is complete. The
 *        ground deliberately knows nothing about the scrim; main.js wires them.
 */
export function initGround(img, opts = {}) {
  host = img?.parentElement ?? null;
  if (!host) return;
  onPhoto = opts.onPhoto ?? (() => {});

  void loadFirst();

  // Init-once. Per-event timers are where this house has leaked; this one is
  // registered exactly once at startup and never re-created.
  if (!checkTimer) checkTimer = setInterval(tick, CHECK_MS);

  window.__ground = () => ({
    assetId: current?.assetId ?? null,
    dayKey: current?.dayKey ?? null,
    shown: current?.img?.dataset.shown === "1",
    layers: host.querySelectorAll("img").length,
    inFlight
  });
  // The specs drive the day boundary rather than sitting out a real one, and
  // drive the stall rather than sitting out 30 seconds to prove a latch clears.
  window.__groundDissolve = (settleMs, stallMs) => dissolve(settleMs, stallMs);
  window.__groundRetry = () => loadFirst();
}
