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

   ⚠ BEHIND `groundDiptych` A FRAME MAY HOLD TWO PHOTOGRAPHS, and that is why
   everything below counts FRAMES rather than <img>s. A portrait preview is
   1440x1920; full-bleed on this 1920x1080 wall it is upscaled 1.33x and cropped
   to ~42% of its content — the worst thing the ground does. Side by side, each
   half is ~952x1080: a 0.667x DOWNSCALE keeping ~84% of the picture, which is a
   better rendition than a landscape photograph gets today. The cost is that the
   one-shot terminal path now has to resolve for a PAIR (half a diptych with the
   substrate showing through the other half is worse than no photograph), and
   that every teardown removes two elements — removing only the first is how
   this would leak one <img> per rotation, forever, on a page that never reloads.
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

/**
 * One-shot terminal path for a WHOLE FRAME, which may be one photograph or two.
 * Whichever arrives first wins and the rest become no-ops: the LAST load, the
 * FIRST error, or the stall.
 *
 * ⚠ `half()` is terminal only when every half is in. A diptych with one image
 * decoded is not a frame — it is one photograph beside a hole, which reads as a
 * broken wall rather than as a memory. And the first error is terminal for the
 * pair, because the alternative is waiting out the stall for a half that has
 * already told us it will never arrive.
 */
function frameLatch(count = 1) {
  let done = false;
  let loaded = 0;
  let stall = null;
  const finish = (fn) => {
    done = true;
    clearTimeout(stall);
    stall = null;
    fn();
  };
  const take = (fn) => () => { if (!done) finish(fn); };
  return {
    take,
    half: (fn) => () => {
      if (done) return;
      if (++loaded >= count) finish(fn);
    },
    arm(fn, ms = STALL_MS) { stall = setTimeout(take(fn), ms); }
  };
}

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

/* Items, not assets: each entry is a FRAME — one photograph, or a pair of
   portraits shown side by side behind `groundDiptych`. */
let pool = [];
let poolCursor = 0;
let poolDayKey = null;

const memoriesEnabled = () => Boolean(globalThis.window?.CONFIG?.features?.groundMemories);

/* ⚠ The diptych rides ON TOP of groundMemories and cannot be had without it.
   Pairing needs `aspect` and `localDateTime`, which only the on-this-day pool
   carries; the flag-off random endpoint hands over one asset at a time with no
   way to know what the next one will be. Flag off (either flag) restores
   landscape-first ordering exactly — that is the rollback path. */
const diptychEnabled = () =>
  memoriesEnabled() && Boolean(globalThis.window?.CONFIG?.features?.groundDiptych);

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

/* A portrait we KNOW is a portrait. `aspect` is null when the caller did not
   request withExif, and the ordering above deliberately treats unknown as
   portrait (conservative: it gets seen last). Pairing must not: an unknown
   asset could be a landscape, and a landscape in a 952-wide half is a heavier
   crop than the full-bleed it would otherwise get. Unknown stays full-bleed. */
const isKnownPortrait = (a) => Number(a?.aspect) > 0 && Number(a.aspect) < LANDSCAPE_MIN_ASPECT;

/** ISO strings sort chronologically; anything else sorts as unknown. */
const timeKey = (a) => (typeof a?.localDateTime === "string" ? a.localDateTime : "");

/**
 * The day's pool as FRAMES.
 *
 * Flag off: exactly `orderByFit`, one photograph per frame — the rollback path,
 * unchanged to the element.
 *
 * Flag on: portraits are paired SAME YEAR, NEAREST IN TIME. On-this-day means
 * every photograph in the pool was taken on the same date, so two portraits
 * from the same year are almost always the same occasion — which is what makes
 * a diptych read as one moment rather than as a collage, and what lets the two
 * halves share one true caption line. Everything else (landscapes, and anything
 * whose orientation the library does not know) stays a full-bleed frame, and
 * the frames are shuffled TOGETHER: once a portrait pair is the best-rendered
 * thing on the wall there is no reason left to defer it, and deferring it meant
 * that on a day you glance twice you never saw a portrait at all.
 *
 * ⚠ AN ODD PORTRAIT IS OMITTED — owner's call, 2026-08-13. Not repeated (the
 * same photograph twice is a mistake, not a diptych), not shown full-bleed
 * (that is the 1.33x upscale this exists to avoid), not held for tomorrow (the
 * pool is per-day and holding one needs state that outlives the day). It is
 * simply not seen this year, and there is at most one per year in the set.
 */
export function buildItems(list, diptych = false) {
  const assets = (list ?? []).filter((a) => a?.id);
  if (!diptych) return orderByFit(assets).map((a) => [a]);

  const singles = assets.filter((a) => !isKnownPortrait(a)).map((a) => [a]);

  const byYear = new Map();
  for (const a of assets.filter(isKnownPortrait)) {
    // "" is its own bucket: photographs whose date we could not parse pair with
    // each other rather than gatecrashing a real year.
    const year = yearOf(a);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(a);
  }

  const pairs = [];
  for (const group of byYear.values()) {
    group.sort((x, y) => timeKey(x).localeCompare(timeKey(y)));
    for (let i = 0; i + 1 < group.length; i += 2) pairs.push([group[i], group[i + 1]]);
  }

  return shuffled([...singles, ...pairs]);
}

/**
 * The line under the photograph: who, where, when — omitting whatever the
 * library does not know, and returning "" when it knows nothing worth saying.
 * Pure, so a spec can pin every shape without a network or a DOM.
 */
/* ⚠ TRIM BEFORE FILTERING. Immich returns a person record with an empty or
   whitespace name for a detected-but-unnamed face, and `"  "` is truthy — a
   bare .filter(Boolean) puts a blank name on the wall followed by a stray
   separator. Caught by a spec, not by looking at it. */
const namesOf = (asset) => (asset?.people ?? []).map((p) => String(p ?? "").trim()).filter(Boolean);

/* City alone is the useful grain — "Nudgee" says more than "Queensland,
   Australia" to someone standing in Nudgee. Country only when it is the only
   thing known, which is what makes a holiday photo still say something. */
const placeOf = (asset) => asset?.city || asset?.country || "";

/* Strings only. The route returns an ISO `localDateTime`; anything else is a
   shape we do not understand, and slicing a number like 20230812 yields
   "2023" — a year that LOOKS right and was never actually parsed. */
function yearOf(asset) {
  const raw = asset?.localDateTime;
  const year = typeof raw === "string" ? raw.slice(0, 4) : "";
  return /^\d{4}$/.test(year) ? year : "";
}

/* Two names read as a couple; beyond that the line becomes a list and stops
   being glanceable, so it degrades to a count. */
function joinPeople(people) {
  if (people.length === 1) return people[0];
  if (people.length === 2) return `${people[0]} & ${people[1]}`;
  if (people.length > 2) return `${people[0]} & ${people.length - 1} others`;
  return "";
}

const uniq = (list) => [...new Set(list)];

export function captionFor(asset) {
  if (!asset) return "";
  const parts = [];

  const people = joinPeople(namesOf(asset));
  if (people) parts.push(people);

  const place = placeOf(asset);
  if (place) parts.push(place);

  const year = yearOf(asset);
  if (year) parts.push(year);

  return parts.join(" · ");
}

/**
 * The line under a FRAME — one photograph or a diptych.
 *
 * A pair gets ONE line, not two: the halves were chosen to be the same moment,
 * so repeating "Nudgee · 2013 / Nudgee · 2013" would be noise. Each category is
 * merged and de-duplicated — "&" joins within a category, "·" between them —
 * which means the common pair (same place, same year, no named faces) reads
 * exactly like a single photograph's caption, because it is describing exactly
 * the same thing. Differing years can only appear via the unknown-date bucket;
 * the line stays true rather than pretending.
 */
export function captionForFrame(assets) {
  const list = (assets ?? []).filter(Boolean);
  if (list.length < 2) return captionFor(list[0]);

  const parts = [];
  const people = joinPeople(uniq(list.flatMap(namesOf)));
  if (people) parts.push(people);

  const places = uniq(list.map(placeOf).filter(Boolean));
  if (places.length) parts.push(places.join(" & "));

  const years = uniq(list.map(yearOf).filter(Boolean)).sort();
  if (years.length) parts.push(years.join(" & "));

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

/**
 * The flag-off draw. Asks for two and prefers one that is not already on the
 * glass: the server caches `rnd:N` for ten minutes, which makes drawing the same
 * asset twice in a row far likelier than chance, and spending the day's one
 * settle on a visual no-op is worse than not settling at all.
 */
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

/** One frame's worth of assets — always an array, 1 or 2 long, never empty.
 *  The whole asset, not just its id: the caption needs the people and the place
 *  that came down with it.
 *  @returns {Promise<object[]|null>} */
async function pickItem(exclude) {
  const single = async () => {
    const asset = await pickRandom(exclude);
    return asset ? [asset] : null;
  };
  if (!memoriesEnabled()) return single();

  const today = localDayKey();
  if (poolDayKey !== today || poolCursor >= pool.length) {
    const fresh = await fetchPool();
    // ⚠ Only adopt a NON-EMPTY set. With the diptych on, a day whose portraits
    // are all unpaired can build to nothing at all, and adopting an empty pool
    // would pin poolDayKey to today and leave the wall permanently on the
    // random fallback with no way back until midnight.
    const items = fresh.length ? buildItems(fresh, diptychEnabled()) : [];
    if (items.length) {
      pool = items;
      poolCursor = 0;
      poolDayKey = today;
    }
  }

  // A date with nothing in the library, or a fetch that failed: the old
  // behaviour is the fallback, never a blank wall.
  if (!pool.length || poolDayKey !== today) return single();

  let next = pool[poolCursor++];
  // Only matters when the day's set is a single frame.
  if (next?.[0]?.id === exclude && poolCursor < pool.length) next = pool[poolCursor++];
  return next?.length ? next : null;
}

/** The caption element is optional — a surface without one simply has no line. */
function paintCaption() {
  const el = document.getElementById("ground-caption");
  if (!el) return;
  const text = memoriesEnabled() ? captionForFrame(current?.assets) : "";
  el.textContent = text;
  el.dataset.blank = text ? "0" : "1";
}

/* ── The diptych's DOM ──────────────────────────────────────────────────────
   The halves are marked in the document rather than tracked only in JS: the CSS
   that places them left and right keys off `data-half`, and the probe counts
   FRAMES by ignoring the right half of each pair. */
function markPair(imgs) {
  imgs.forEach((img, i) => { img.dataset.half = String(i); });
  if (host) host.dataset.diptych = "1";
}

function unmarkFrame(imgs) {
  for (const img of imgs) delete img.dataset.half;
}

/**
 * Set the container flag from the DOM's own state. Only ever clears late.
 *
 * ⚠ WHY IT CANNOT BE CLEARED WHEN THE INCOMING FRAME IS A SINGLE: the flag is
 * what makes every ground <img> absolutely positioned, and an absolutely
 * positioned element paints ABOVE a static sibling regardless of DOM order.
 * Clear it while an outgoing diptych is still fading and the old pair would
 * jump on top of the incoming photograph, turning the settle into a cut with
 * the wrong picture on the glass for a minute.
 */
function syncDiptychAttr() {
  if (!host) return;
  if (host.querySelector("img[data-half]")) host.dataset.diptych = "1";
  else delete host.dataset.diptych;
}

/* A single photograph is handed to the scrim as an ELEMENT, exactly as before
   the diptych existed; only a pair is handed over as an array. That keeps the
   flag-off call signature identical rather than merely equivalent. */
const frameArg = (imgs) => (imgs.length > 1 ? imgs : imgs[0]);

/** The first frame of the session. */
async function loadFirst(stallMs = STALL_MS) {
  if (inFlight || current) return false;
  const first = host?.querySelector("img");
  if (!first) return false;

  inFlight = true;
  let handedOff = false;
  try {
    const assets = await pickItem(null);
    if (!assets?.length) return false;

    /* #ground is in index.html; a pair's second half is created here — and
       removed again on any failure, so a frame that never arrives leaves
       exactly the DOM it started with. */
    const imgs = [first];
    for (let i = 1; i < assets.length; i++) {
      const extra = document.createElement("img");
      extra.alt = "";
      imgs.push(extra);
    }
    if (imgs.length > 1) markPair(imgs);

    const shot = frameLatch(imgs.length);
    // Both failure paths leave `current` null on purpose — that is what the
    // tick reads to know there is still no photograph.
    const fail = () => {
      unmarkFrame(imgs);
      for (const extra of imgs.slice(1)) extra.remove();
      syncDiptychAttr();
      inFlight = false;
    };
    const settle = () => {
      for (const el of imgs) el.dataset.shown = "1";
      current = { imgs, assets, assetId: assets[0].id, dayKey: localDayKey() };
      paintCaption();
      inFlight = false;
      onPhoto(frameArg(imgs), { transitioning: false });
    };

    for (const el of imgs) {
      el.onload = shot.half(settle);
      el.onerror = shot.take(fail);
    }
    shot.arm(fail, stallMs);

    imgs.forEach((el, i) => {
      el.decoding = "async";
      if (i > 0) host.append(el);
      el.src = thumbUrl(assets[i].id);
    });
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
    const assets = await pickItem(current.assetId);
    if (!assets?.length) return false;   // keep the frame we have; retry next tick

    const old = current;
    const imgs = assets.map(() => {
      const el = document.createElement("img");
      el.alt = "";
      el.decoding = "async";
      el.style.transition = `opacity ${settleMs}ms linear`;
      return el;
    });
    if (imgs.length > 1) markPair(imgs);

    const shot = frameLatch(imgs.length);
    const settle = () => {
      for (const el of imgs) el.dataset.shown = "1";
      current = { imgs, assets, assetId: assets[0].id, dayKey: localDayKey() };
      paintCaption();
      inFlight = false;

      // The incoming photograph's own opacity may be lower than the outgoing
      // one's. It may not be applied yet — for the length of the settle both
      // are on the glass, and the scrim has to protect the brighter of them.
      onPhoto(frameArg(imgs), { transitioning: true });

      setTimeout(() => {
        // ⚠ EVERY element of the outgoing frame. Removing only the first is how
        // a diptych leaks one <img> per rotation on a page that runs for weeks.
        for (const el of old.imgs) el.remove();
        // #ground names whatever photograph is currently the ground. Carrying
        // the id across keeps that true for the life of the page, so nothing
        // that looks it up ever holds a detached node. On a pair it names the
        // left half — the one the scrim samples first and the specs read.
        imgs[0].id = old.imgs[0].id || "ground";
        syncDiptychAttr();
        onPhoto(frameArg(imgs), { transitioning: false });
      }, settleMs + CLEANUP_BUFFER_MS);
    };

    // A dead incoming frame must not take the live one with it: drop the
    // half-built nodes and leave the day key as it was so the tick retries.
    const fail = () => {
      for (const el of imgs) el.remove();
      syncDiptychAttr();
      inFlight = false;
    };
    for (const el of imgs) {
      el.onload = shot.half(settle);
      el.onerror = shot.take(fail);
    }
    shot.arm(fail, stallMs);

    // Appended BEFORE the src so the element has rendered one frame at opacity
    // 0 — a node inserted already at its final state has nothing to transition
    // from and would cut rather than settle.
    for (const el of imgs) host.append(el);
    imgs.forEach((el, i) => { el.src = thumbUrl(assets[i].id); });
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
    // Both halves of a diptych, so "which memories are on the wall" is one read.
    assetIds: (current?.assets ?? []).map((a) => a.id),
    dayKey: current?.dayKey ?? null,
    shown: Boolean(current?.imgs?.length) && current.imgs.every((i) => i.dataset.shown === "1"),
    /* ⚠ `layers` STILL MEANS PHOTOGRAPHIC LAYERS — 1 at rest, 2 mid-settle.
       It is the soak metric the cutover doc reads, so it must not silently
       start counting the diptych's second half as a leak. Frames are counted by
       ignoring right halves; `imgs` is the raw element count beside it. */
    layers: host.querySelectorAll('img:not([data-half="1"])').length,
    imgs: host.querySelectorAll("img").length,
    pair: (current?.imgs?.length ?? 0) > 1,
    inFlight
  });
  // The specs drive the day boundary rather than sitting out a real one, and
  // drive the stall rather than sitting out 30 seconds to prove a latch clears.
  window.__groundDissolve = (settleMs, stallMs) => dissolve(settleMs, stallMs);
  window.__groundRetry = (stallMs) => loadFirst(stallMs);
}
