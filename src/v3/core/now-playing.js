/* ═══════════════════════════════════════════════════════════════════════════
   WHAT'S PLAYING, AMBIENTLY — the field's second fact.

   ── The gap this fills ──────────────────────────────────────────────────────

   V3 has had a media surface since Phase 4, and nobody has ever seen it.
   `subjects/media.js` is DEPTH 3 and VOICE-SUMMONED: it exists to answer "show
   me what's playing" and it takes the whole wall to do it. Nothing in V3 has
   ever put music on the screen because music STARTED. Confirmed by `scrot` on
   the glass on 2026-08-09 while `media_player.living_room` was playing: the
   wall showed the day's photograph and the hour, and nothing else.

   The owner's call, made while deciding a separate question about sound
   presence: "when plex or spotify is playing I would want it to see it on the
   screen anyway." This is that surface. It is not a smaller copy of the depth-3
   subject — it is the ambient half that was missing, and the two answer the
   same question at two different volumes.

   ── Why depth 0, and only depth 0 ───────────────────────────────────────────

   The field is where this wall lives. Depth 1 is the house interrupting you,
   depth 2 is the day laid out for someone standing there, depth 3 is one thing
   that was asked for — and music playing is none of those. It is a fact about
   the room, like the hour, true whether or not anyone is looking. So it sits in
   `.depth--field` and disappears with it, which also means the deeper surfaces
   are untouched: the composer already places a now-playing candidate at depth 2
   when it earns a cell, and the subject still owns depth 3.

   ⚠ THE CORNER RULE. Four corners, one owner each — hour BL · rail BR · a
   subject's title TL · the transcript TR. That rule cost seven defects to
   establish and this surface takes BOTTOM RIGHT, which is the rail's. The two
   can never be on the glass together: the rail is `opacity: 0` outside depths 1
   and 2 (css/compose.css) and this lives inside the depth-0 layer, so they are
   mutually exclusive BY CONSTRUCTION rather than by agreement.
   tests/v3-now-playing.spec.js asserts it, because "by construction" is a claim
   that stops being true the day someone widens either scope.

   Bottom right is also the legible corner. `--scrim` is a gradient `to top` at
   full solved opacity on the floor and 72% of it by 38% height; the whole of
   this surface sits inside the bottom 216px, i.e. under ~85% of an opacity that
   core/scrim.js MEASURED against the photograph actually on the glass. Every
   other corner would have been a new contrast problem.

   ── One reader, so the two surfaces can never disagree ──────────────────────

   `houseSnapshot()`, with the same precedence `subjects/media.js` uses: a
   configured media_player first, a Plex session only as a fallback. A
   media_player entity is the live state of a device in THIS house; a Plex
   session may be a stream on someone's phone at work. Sharing the reader is
   what stops the ambient band and the summoned subject describing two different
   things — and it is the same reader the attention queue scores, so the spread
   agrees too.

   ⚠ KNOWN LIMIT, not a defect of this file. `houseSnapshot`'s reader requires
   `media_title`, so a Sonos playing TV audio (`media_player.living_room`,
   source TV — the path the owner confirmed is audible in the kitchen) may
   report `playing` with no title and produce nothing here. If that turns out to
   matter, the fix belongs in `nowPlayingFrom()` in houseSnapshot.js where BOTH
   surfaces and the attention queue would get it at once. Fixing it locally here
   would be exactly the divergence this module is shaped to avoid.

   ── What it costs at rest ───────────────────────────────────────────────────

   Nothing. There is no timer that paints: the surface is written only when the
   ANSWER changes, which is what `signature` is for — Sonos pushes an entity
   update every few seconds while a track plays (position, volume) and re-setting
   an identical `src` would re-decode a bitmap for a wall that did not change.
   The calm law survives here in its one surviving clause: it moves when music
   starts and when the track changes, and both are causes the room can hear.
   ═══════════════════════════════════════════════════════════════════════════ */

import { on } from "../../js/core/eventBus.js";
import { houseSnapshot } from "../../js/services/houseSnapshot.js";

/* Collapse a burst of entity updates into one read. A track change arrives as
   several `ha:state-updated` events in quick succession (state, then the
   artwork, then the title), and evaluating each one would paint an intermediate
   answer — the old artwork under the new title — for a few frames. One
   outstanding timer at a time, cleared when it fires; not a per-event timer that
   accumulates. */
const SETTLE_MS = 400;

/* The Plex half of the answer comes from the HTTP cache that main.js refreshes
   every 300 s, and an HTTP cache emits no bus event when it changes. This is the
   only reason a timer exists here at all, and it paints nothing unless the
   signature moved. Init-once, per the kiosk discipline in CLAUDE.md. */
const RECHECK_MS = 60_000;

/* Longer than --m-calm (350 ms), never `transitionend`. The element is inside
   `.depth--field`, which is `visibility: hidden` at every other depth — and a
   transition event does not fire on a hidden subtree, which is the bug class
   that cost this house 709 zombie wrappers. */
const CLEAR_MS = 1200;

/* What the depth-3 subject titles an artwork with no artist. Reused rather than
   re-chosen so the two surfaces say the same word about the same track. */
const NO_SUB = "Playing";

let el = null;
let unsubscribe = null;
let recheckTimer = null;
let settleTimer = null;
let clearTimer = null;
let signature = null;         // what is on the glass, or null for nothing
let renders = 0;              // how many times the glass actually changed
let last = null;

/* Read per-call, never at module load: ES imports hoist above the point where
   /js/config.js sets window.CONFIG, so a module-level read is frozen to
   `undefined` and the flag silently reads false forever. This repo has paid for
   that three times. */
function flag(name) {
  return Boolean(globalThis.window?.CONFIG?.features?.[name]);
}

/**
 * What, if anything, is playing — in the shape this surface renders.
 *
 * Pure and exported so the precedence is testable without a browser. The order
 * is `subjects/media.js`'s, deliberately: see the header.
 *
 * @param {object|null} house  a houseSnapshot() result
 * @returns {{cell: string, title: string, sub: string, image: string|null}|null}
 */
export function playingFrom(house) {
  if (house?.nowPlayingActive && house.nowPlayingTitle) {
    return {
      cell: "nowPlaying",
      title: house.nowPlayingTitle,
      sub: house.nowPlayingSub || NO_SUB,
      image: house.nowPlayingImage || null
    };
  }
  if (house?.plexActive && house.plexText) {
    return { cell: "plex", title: house.plexText, sub: NO_SUB, image: house.plexImage || null };
  }
  return null;
}

/** Everything about the answer that the glass can show. Two tracks with the
 *  same title and different artwork are different answers; the same track
 *  reported forty times while it plays is one. */
function signatureOf(playing) {
  return playing ? `${playing.cell}|${playing.title}|${playing.sub}|${playing.image ?? ""}` : null;
}

function cancelClear() {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

function show(playing) {
  // The artwork is being replaced or re-shown, so whatever was scheduled to
  // strip it is now wrong. This is the overwritten-before-consumed path that
  // CLAUDE.md names explicitly, and it is the one that gets forgotten.
  cancelClear();

  el.sub.textContent = playing.sub;
  el.title.textContent = playing.title;
  el.root.dataset.cell = playing.cell;

  if (playing.image) {
    // Cleared BEFORE the load, so a previous failure cannot leave the new
    // artwork hidden. `load` and `error` are bound once at init — a listener
    // added per track would accumulate one per song for the life of the page.
    delete el.art.dataset.blank;
    if (el.art.getAttribute("src") !== playing.image) el.art.src = playing.image;
  } else {
    el.art.dataset.blank = "1";
    el.art.removeAttribute("src");
  }

  el.root.dataset.shown = "1";
}

function hide() {
  el.root.dataset.shown = "0";

  /* The words and the picture outlive the fade, or the surface empties itself
     in front of the room and THEN fades an empty rectangle. Dropping the src is
     not tidiness: a detached-or-hidden <img> that still has one keeps its
     decoded bitmap, and this page runs for weeks.

     `removeAttribute` rather than `src = ""`, which is what dom.js's teardown
     does — that node is being detached in the same breath, this one is not, and
     an empty src on a live node re-requests the PAGE url in Chromium. */
  cancelClear();
  clearTimer = setTimeout(() => {
    clearTimer = null;
    el.sub.textContent = "";
    el.title.textContent = "";
    el.art.dataset.blank = "1";
    el.art.removeAttribute("src");
  }, CLEAR_MS);
}

/**
 * One pass: read the house, and write the glass only if the answer moved.
 *
 * @param {object} [opts]
 * @param {object|null} [opts.snapshot]  inject the house rather than reading it.
 *        `undefined` means "read the real one"; `null` means "an empty house",
 *        and the two are deliberately different — see houseSnapshot's header on
 *        absent not being empty.
 */
export function evaluateNowPlaying({ snapshot } = {}) {
  if (!el) return null;

  const house = snapshot === undefined ? houseSnapshot() : snapshot;
  const playing = playingFrom(house);
  const next = signatureOf(playing);

  if (next !== signature) {
    signature = next;
    renders += 1;
    if (playing) show(playing);
    else hide();
  }

  last = {
    playing: playing ? { cell: playing.cell, title: playing.title, sub: playing.sub, hasImage: Boolean(playing.image) } : null,
    shown: el.root.dataset.shown === "1",
    renders,
    at: new Date().toISOString()
  };
  return last;
}

function settle() {
  if (settleTimer) return;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    evaluateNowPlaying();
  }, SETTLE_MS);
}

/** The last verdict, for __v3(). Null before the first pass. */
export function nowPlayingState() {
  return last;
}

/**
 * @returns {boolean} whether the surface is live. False when flag-off, which is
 *          no listener, no timer and no attribute — the flag-off build is the
 *          build that shipped before it.
 */
export function initNowPlaying() {
  if (!flag("v3NowPlaying")) return false;
  if (unsubscribe) return true;

  const root = document.getElementById("now-playing");
  if (!root) return false;
  el = {
    root,
    art: document.getElementById("now-playing-art"),
    sub: document.getElementById("now-playing-sub"),
    title: document.getElementById("now-playing-title")
  };
  if (!el.art || !el.sub || !el.title) {
    el = null;
    return false;
  }

  /* Bound once, for the life of the page. An artwork URL that 404s must not
     leave a broken-image glyph 120px wide on the wall, and a `{ once: true }`
     listener re-added per track leaks one listener per song. */
  el.art.addEventListener("error", () => { el.art.dataset.blank = "1"; });
  el.art.addEventListener("load", () => { delete el.art.dataset.blank; });

  /* Subscribed BEFORE anything reads: the SSE stream's opening snapshot is the
     only bulk fill there is, and a subscriber registered after it has missed
     the one event that says what is already playing. Same rule as the entity
     feed's placement in main.js. */
  unsubscribe = on("ha:state-updated", (entity) => {
    if (String(entity?.entity_id ?? "").startsWith("media_player.")) settle();
  });

  // Registered before the first pass, not after — a probe driving this over CDP
  // can arrive in that gap, and a hook that only exists once a load has settled
  // is a flake this repo has root-caused twice.
  window.__v3NowPlaying = () => nowPlayingState();
  /* `__v3NowPlayingSet()` with no argument reads the real house;
     `__v3NowPlayingSet(null)` asserts an empty one. The two are different
     questions and a spec needs both. */
  window.__v3NowPlayingSet = (house) =>
    evaluateNowPlaying(house === undefined ? {} : { snapshot: house });

  recheckTimer = setInterval(() => evaluateNowPlaying(), RECHECK_MS);

  evaluateNowPlaying();
  return true;
}

/** Test seam — back to cold, including every timer and the subscription. */
export function __resetNowPlaying() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (recheckTimer) { clearInterval(recheckTimer); recheckTimer = null; }
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
  cancelClear();
  el = null;
  signature = null;
  renders = 0;
  last = null;
}
