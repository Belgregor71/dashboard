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
/* The answer to "not this one" — brisk on purpose, and the exception that
   proves the rule above. The sixty-second drift is right for a change with no
   cause the room can see; this one has the most visible cause there is, since
   someone in the room just said so out loud. Slow here does not read as calm,
   it reads as not listening. */
const VETO_SETTLE_MS = 1200;
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

/* ⚠⚠ A BURST IS NOT TWO MOMENTS — it is one photograph printed twice, and the
   seam makes the duplication MORE obvious rather than less. Seen on the glass
   2026-08-14: the first pair the wall ever showed was the same cocktails twice.

   🔑 THE REAL SHAPE, measured on that day's live pool (32 portraits across six
   years): EIGHT pairs share an identical `localDateTime` TO THE MILLISECOND.
   They are not library duplicates — the thumbnails differ in bytes and in
   framing — so they are separate exposures that Immich stamped with the same
   capture time. Nearest-in-time therefore does not merely *sometimes* pair a
   burst; on this library it pairs them PREFERENTIALLY, because a zero gap sorts
   adjacent and wins every time. That is why the very first pair on the wall was
   a double, and why this is a rule rather than a nicety.

   🔑 THE THRESHOLD IS READ OFF A GAP IN THE DATA, not chosen by taste. The
   sorted gaps within a year run: 0s (x8), 6.7s, 87s, then 3m47s, 31min, 35min,
   43min, 63min, … — so every value between ~90 SECONDS and ~3.5 MINUTES
   produces exactly the same result on this pool. Two minutes sits in the middle
   of that empty band, which is the most defensible place to put it. The 3m47s
   pair stays paired, and it should: two frames four minutes apart are two looks
   at one scene, which is the diptych working. */
const BURST_MS = 2 * 60 * 1000;

/* ⚠ FAILS OPEN, and it has to. `Date.parse` of anything we do not understand is
   NaN, and every comparison with NaN is false — so an unparseable pair is never
   called a burst. Dropping a photograph needs positive evidence that a near-
   identical one is already in the pool; not knowing is not evidence. */
function isBurst(a, b) {
  const t1 = Date.parse(timeKey(a));
  const t2 = Date.parse(timeKey(b));
  return Math.abs(t2 - t1) < BURST_MS;
}

/**
 * One photograph per moment, from a list already sorted by time.
 *
 * Each survivor is compared against the last one KEPT, not against its
 * immediate predecessor: a five-shot burst is one moment, and comparing
 * neighbours would keep every second frame of it.
 *
 * ⚠ A dropped frame is OMITTED from the day, exactly as the odd portrait is —
 * not shown full-bleed (that is the 1.33x upscale this feature exists to
 * avoid), not held for tomorrow. A near-identical photograph taken in the same
 * second is not a second memory, and the pool already prefers omitting a frame
 * to showing a bad one.
 *
 * ⚠ WHAT IT COSTS, measured on the live pool the day it shipped: pairs 15 -> 8
 * and omissions 2 -> 16. Of the 14 newly omitted, ELEVEN are the same-moment
 * duplicates this exists to remove; the other THREE are parity — collapsing an
 * even group to an odd one leaves a new odd portrait out. Eight of the fifteen
 * pairs it replaced were doubles, so the wall trades ~7 frames a day for not
 * showing the same photograph beside itself.
 */
function oneFrameEach(sorted) {
  const kept = [];
  for (const asset of sorted) {
    if (kept.length && isBurst(kept[kept.length - 1], asset)) continue;
    kept.push(asset);
  }
  return kept;
}

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
 * ⚠ A BURST COLLAPSES TO ONE FRAME before any pairing happens — see BURST_MS.
 * Nearest-in-time is the right rule and it has two bad ends; this closes the
 * near one, where the pair is the same photograph twice.
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
    // One frame per moment BEFORE pairing, or a burst pairs with itself.
    const moments = oneFrameEach(group);
    for (let i = 0; i + 1 < moments.length; i += 2) pairs.push([moments[i], moments[i + 1]]);
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

/* The occasion the photograph belonged to — "Mexico 2017" — joined onto the
   asset server-side from the vault's dated notes (server/services/photoTrips.js).
   Absent on almost every photograph, which is correct: most days are not a trip.

   It REPLACES the bare year rather than joining it, because it already carries
   one (photoTrips appends the photo's own year for exactly this reason). A line
   reading "Playa del Carmen · Mexico 2017 · 2017" would be the feature
   announcing itself instead of saying something. */
const tripOf = (asset) => String(asset?.trip ?? "").trim();

/* One photograph's "when", which is its trip if it had one and its year
   otherwise. Having a single function for it is what keeps the diptych honest:
   a pair where one half is on the trip and the other is not merges to
   "Mexico 2017 & 2017", which is odd-looking and TRUE, where picking one for
   both halves would caption a photograph with somewhere it never was. */
const whenOf = (asset) => tripOf(asset) || yearOf(asset);

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

  const when = whenOf(asset);
  if (when) parts.push(when);

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
 * the same thing. Differing "whens" can only appear via the unknown-date bucket
 * — the halves are chosen within minutes of each other, so they share a trip
 * whenever either has one — and the line stays true rather than pretending.
 */
export function captionForFrame(assets) {
  const list = (assets ?? []).filter(Boolean);
  if (list.length < 2) return captionFor(list[0]);

  const parts = [];
  const people = joinPeople(uniq(list.flatMap(namesOf)));
  if (people) parts.push(people);

  const places = uniq(list.map(placeOf).filter(Boolean));
  if (places.length) parts.push(places.join(" & "));

  const whens = uniq(list.map(whenOf).filter(Boolean)).sort();
  if (whens.length) parts.push(whens.join(" & "));

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

/**
 * "Not this one." Hide every photograph currently on the ground and move on.
 *
 * Returns what it hid so the voice can say something true — how many, and
 * nothing at all when there was nothing to hide. A frame is hidden WHOLE: on a
 * diptych the room is looking at both halves and pointing at neither, and
 * hiding one would leave the other to come back tomorrow beside a new partner,
 * which is not what anyone meant.
 *
 * ⚠ THE POOL IS DRAWN ONCE A DAY, so the server list alone is not enough — the
 * rejected photograph is already in memory and would keep coming round until
 * midnight, which looks exactly like the veto not working. Both are cleared.
 *
 * @returns {Promise<{ hidden: string[], pair: boolean }>}
 */
export async function vetoCurrent() {
  const assets = current?.assets ?? [];
  const ids = assets.map((a) => a.id).filter(Boolean);
  if (!ids.length) return { hidden: [], pair: false };

  const pair = ids.length > 1;
  const gone = new Set(ids);
  // Drop every FRAME that contains one, so half a vetoed pair cannot survive as
  // a single. Filtering in place keeps the cursor's meaning: entries before it
  // have been seen, and removing a seen one would show an unseen frame twice.
  let removedBehind = 0;
  pool = pool.filter((frame, i) => {
    const doomed = frame.some((a) => gone.has(a.id));
    if (doomed && i < poolCursor) removedBehind++;
    return !doomed;
  });
  poolCursor = Math.max(0, poolCursor - removedBehind);

  try {
    await fetch("/api/immich/hidden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
  } catch {
    /* The wall obeys either way — it has already dropped them from today's pool
       and is about to move on. A veto that only lasts until midnight is a much
       better failure than a voice turn that errors out mid-sentence. */
  }

  /* ⚠ NOT the ambient dissolve. `DISSOLVE_MS` is a full SIXTY SECONDS, because
     the ten-minute rotation has no cause the room can see and a slow drift is
     how it stays calm. A veto is the opposite: someone just spoke to the wall,
     so the cause is the most visible thing in the room, and the calm law allows
     movement exactly here. Left on the ambient setting the photograph the room
     just rejected sits there fading for a minute, which reads as being ignored
     — caught by a spec, not by looking at it. */
  await dissolve(VETO_SETTLE_MS);
  return { hidden: ids, pair };
}

/**
 * "Bring that back." Undoes the most recent veto, server-side.
 *
 * ⚠ It does NOT put the photograph back into today's pool, and that is honest
 * rather than lazy: the pool is a shuffled walk drawn once a day, and splicing
 * a frame back into a position that has already been passed would either show
 * it twice or not at all. It returns tomorrow, which is what "on this day"
 * means anyway.
 *
 * @returns {Promise<{ restored: string[] }>}
 */
export async function restoreLastVeto() {
  try {
    const res = await fetch("/api/immich/hidden/undo", { method: "POST" });
    const body = await res.json();
    return { restored: Array.isArray(body?.restored) ? body.restored : [] };
  } catch {
    return { restored: [] };
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
  // The veto without the microphone — how a spec drives it, and the only way to
  // prove it on the kiosk without saying "not this one" at the real wall and
  // really losing a photograph.
  window.__groundVeto = () => vetoCurrent();
  window.__groundRetry = (stallMs) => loadFirst(stallMs);
}
