/* ═══════════════════════════════════════════════════════════════════════════
   THE ROOMS THAT ARE PLAYING — depth 0, and the surface core/now-playing.js
   replaces.

   ── What was wrong, precisely ───────────────────────────────────────────────

   The wall could only ever say one thing was playing, and it named it after a
   DEVICE. Both were reported by the owner on 2026-08-23 and both were confirmed
   on the live house the same hour, with two Plex streams running at once: the
   glass said "APPLE TV · High Potential" and gave no sign that Practical Magic
   was playing in the piano room.

   Three independent `return`s caused the first half. `houseSnapshot.nowPlayingFrom`
   bailed at the first playing speaker; `plexFrom` took `sessions[0]`; and this
   file's own `playingFrom` chose between the two. None of them was a design
   decision about how many things a house can be doing at once.

   The second half was the eyebrow: Plex reports a CLIENT ("Apple TV", and via
   the webplayer, "Edge"), which is not where anything is playing. That is fixed
   at the server now — see server/routes/plex.js `parseRoomMap`, which resolves
   the room from identifiers that deliberately never reach the browser.

   ── The shape ───────────────────────────────────────────────────────────────

   ROWS ARE ROOMS, in config order — Lounge Room above Piano Room — each
   carrying whatever is making sound in it. A house does not have "a Plex" and
   "a Sonos", it has rooms; naming the room is what makes the line an answer
   rather than a label, and it makes the plural native, because rooms are a
   fixed list where sources are not. The order never reshuffles under the eye.

   ⚠ THE INK BUDGET IS FIXED, NOT THE ROW COUNT. Two rooms means smaller
   artwork, never a taller surface. The band grows upward from the bottom-right
   corner it owns, and core/scrim.js only guarantees legibility to y≈0.46
   (BAND_MIN_COVERAGE) — measured at two rooms the stack tops out at y=0.368,
   which is inside it with room to spare. A third room would not be, which is
   why MAX_ROWS is 2 and not "however many there are".

   ── Music is a record, film is a frame ──────────────────────────────────────

   The one bold thing here, and it earns it by being an instrument rather than
   an ornament: the artwork makes EXACTLY ONE REVOLUTION over the track's
   duration, so the disc itself is the clock. A vinyl spinning at 33⅓ would tell
   you nothing. For a 5:19 track this is 1.13°/sec — invisible frame to frame,
   obvious if you glance twice, which is the register this wall already works
   in. It stops when the music stops, which is a truer pause indicator than any
   glyph and costs nothing to draw.

   Video keeps its rectangle and gets a rule that fills. A 16:9 still forced
   into a circle is the mistake compose.css:351 already records being made and
   reverted — and the shapes are not even consistent within Plex: an episode's
   `thumb` is a 16:9 still and a movie's is a 2:3 poster. So the frame takes a
   FIXED HEIGHT and its natural width, and the artwork keeps its own shape.

   ── What it costs at rest: nothing ──────────────────────────────────────────

   ⚠ THERE IS NO TIMER DRIVING THE PROGRESS, and that is the whole trick. Sonos
   publishes `media_position_updated_at` — the exact instant the position was
   measured — so elapsed time is derivable at any moment without sampling. Both
   the ring and the rotation are therefore ONE CSS ANIMATION with a negative
   `animation-delay`: the compositor interpolates, nothing repaints, no
   JavaScript runs per frame, and it cannot drift on a page that stays up for
   weeks. It re-syncs on every entity push for free, because a push rewrites the
   delay.

   The DOM is written only when the ANSWER changes — `signature` — because Sonos
   pushes an update every few seconds while a track plays (position, volume) and
   re-setting an identical `src` would re-decode a bitmap for a wall that did
   not change.
   ═══════════════════════════════════════════════════════════════════════════ */

import { on } from "../../js/core/eventBus.js";
import { houseSnapshot } from "../../js/services/houseSnapshot.js";

/* Collapse a burst of entity updates into one read. A track change arrives as
   several `ha:state-updated` events in quick succession (state, then artwork,
   then title) and evaluating each would paint an intermediate answer — the old
   artwork under the new title — for a few frames. */
const SETTLE_MS = 400;

/* Plex arrives over an HTTP cache that emits no bus event when it changes. This
   is the only reason a timer exists in this file at all, and it paints nothing
   unless the signature moved. Init-once, per the kiosk discipline. */
const RECHECK_MS = 60_000;

/* Longer than --m-calm (350 ms), never `transitionend`: this lives inside
   `.depth--field`, which is `visibility: hidden` at every other depth, and a
   transition event does not fire on a hidden subtree. That is the bug class
   that cost this house 709 zombie wrappers. */
const CLEAR_MS = 1200;

/* Two rooms. See the header — this is a scrim measurement, not a preference. */
export const MAX_ROWS = 2;

let host = null;
let unsubscribe = null;
let recheckTimer = null;
let settleTimer = null;
let clearTimer = null;
let signature = null;
let renders = 0;
let last = null;

function flag(name) {
  return Boolean(globalThis.window?.CONFIG?.features?.[name]);
}

/* ── The clock ──────────────────────────────────────────────────────────────
   Owner's call, 2026-08-23: a MOVIE reads in hours and minutes, everything else
   in minutes and seconds. Seconds on a two-hour film are noise.

   ⚠ DRIVEN BY CONTENT TYPE, NEVER BY A DURATION THRESHOLD. A feature-length
   episode is still an episode and reads `92:15`; a short film is still a film
   and reads `0:41`. A threshold gets both backwards, and the type is sitting
   right there in the payload (`type` from Plex, `media_content_type` from HA).
─────────────────────────────────────────────────────────────────────────── */
export function formatClock(totalSeconds, contentType) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const whole = Math.floor(totalSeconds);
  if (contentType === "movie") {
    return `${Math.floor(whole / 3600)}:${String(Math.floor((whole % 3600) / 60)).padStart(2, "0")}`;
  }
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * How far through a row is, right now.
 *
 * @returns {{elapsed: number, duration: number, fraction: number}|null} null
 *          when the source reported no usable clock — which is a real state
 *          (a live stream has no duration) and renders as artwork with no
 *          progress rather than as a bar stuck at zero.
 */
export function progressOf(row, now = Date.now()) {
  const duration = Number(row?.duration);
  const position = Number(row?.position);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(position) || position < 0) return null;

  /* `readingAt` is when the position was MEASURED, not when the track started.
     Without it the only honest thing to show is the position as reported, so
     the drift term is dropped rather than guessed at. */
  const since = Number.isFinite(row?.readingAt) && row.readingAt > 0
    ? Math.max(0, (now - row.readingAt) / 1000)
    : 0;

  /* Clamped at both ends. A stale reading across a track change can put elapsed
     past the duration, and an animation delay longer than its own duration
     restarts the ring from zero — which reads as the track having just begun.
     Better to sit at the end until the next push corrects it. */
  const elapsed = Math.min(duration, position + since);
  return { elapsed, duration, fraction: elapsed / duration };
}

/**
 * The rows this surface will draw, capped and normalised.
 *
 * Pure and exported so the ordering and the cap are testable without a browser.
 *
 * @param {object|null} house a houseSnapshot() result
 */
export function roomsFrom(house) {
  const rows = Array.isArray(house?.mediaRooms) ? house.mediaRooms : [];
  return rows.filter((r) => r?.room && r?.title).slice(0, MAX_ROWS);
}

/** Everything about the answer the glass can show. The clock is deliberately
 *  NOT in here: it advances every second and the surface must not rewrite the
 *  DOM for that — the CSS animation already carries it. */
function signatureOf(rows) {
  if (!rows.length) return null;
  return rows
    .map((r) => `${r.room}|${r.cell}|${r.kind}|${r.title}|${r.meta ?? ""}|${r.image ?? ""}`)
    .join("~");
}

function cancelClear() {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

/* ⚠ STRIP BEFORE DETACHING. A detached <img> that still carries a src keeps its
   decoded bitmap alive, and this page runs for weeks with a track changing
   every few minutes. `removeAttribute` rather than `src = ""`, which re-requests
   the PAGE url in Chromium. */
function stripImages(node) {
  if (!node) return;
  for (const img of node.querySelectorAll("img")) img.removeAttribute("src");
}

const SVG_NS = "http://www.w3.org/2000/svg";
/* r=64 in a 136 box. The dasharray must agree with it or the ring lies about
   how far through the track is, so it is derived rather than typed. */
const RING_R = 64;
const RING_C = 2 * Math.PI * RING_R;

function ringSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "mdisc__ring");
  svg.setAttribute("viewBox", "0 0 136 136");
  svg.setAttribute("aria-hidden", "true");
  for (const cls of ["mdisc__track", "mdisc__fill"]) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("class", cls);
    circle.setAttribute("cx", "68");
    circle.setAttribute("cy", "68");
    circle.setAttribute("r", String(RING_R));
    svg.appendChild(circle);
  }
  return svg;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // textContent, never innerHTML — every string here is data, and some of it
  // comes off an upstream this house does not control.
  if (text != null) node.textContent = text;
  return node;
}

function artwork(src) {
  const img = document.createElement("img");
  img.alt = "";
  /* Bound per node because the node is per row and is discarded with it — this
     is not the init-once case. An artwork URL that 404s must not leave a
     broken-image glyph on the wall. */
  img.addEventListener("error", () => { img.dataset.blank = "1"; }, { once: true });
  if (src) img.src = src;
  else img.dataset.blank = "1";
  return img;
}

/** Hand the row's clock to CSS, or take it away. One place, so the ring, the
 *  rotation and the rule can never disagree about how far through it is. */
function applyProgress(node, row) {
  const p = progressOf(row);
  if (!p) {
    delete node.dataset.timed;
    node.style.removeProperty("--dur");
    node.style.removeProperty("--delay");
    node.style.removeProperty("--prog");
    return;
  }
  node.dataset.timed = "1";
  node.style.setProperty("--dur", `${p.duration}s`);
  node.style.setProperty("--delay", `-${p.elapsed}s`);
  // The reduced-motion fallback: with the animation off, this is what places
  // the ring and the record. Unitless, so calc() can drive both.
  node.style.setProperty("--prog", String(p.fraction));
}

function buildRow(row) {
  const node = el("div", "mroom");
  // The deixis address: when the voice names something, core/voice.js lights
  // the matching cell. Same vocabulary the composed cells use.
  node.dataset.cell = row.cell;
  node.dataset.kind = row.kind;
  node.dataset.room = row.room;

  const lines = el("div", "mroom__lines");
  lines.appendChild(el("p", "mroom__where measured", row.room));
  lines.appendChild(el("p", "mroom__what measured", row.title));
  /* No clock at depth 0 — owner's call, 2026-08-23. The ring and the rule say
     how far through it is; the numbers wait until depth 2, where somebody is
     close enough to want them. An absent meta line is no node at all rather
     than an empty one, so the column does not carry a phantom gap. */
  if (row.meta) lines.appendChild(el("p", "mroom__meta measured", row.meta));
  node.appendChild(lines);

  if (row.kind === "music") {
    const disc = el("div", "mdisc");
    disc.appendChild(ringSvg());
    const plate = el("div", "mdisc__plate");
    plate.appendChild(artwork(row.image));
    disc.appendChild(plate);
    disc.appendChild(el("div", "mdisc__spindle"));
    applyProgress(disc, row);
    node.appendChild(disc);
  } else {
    const frame = el("div", "mframe");
    const still = el("div", "mframe__still");
    still.appendChild(artwork(row.image));
    frame.appendChild(still);
    const rule = el("div", "mframe__rule");
    rule.appendChild(document.createElement("i"));
    frame.appendChild(rule);
    applyProgress(frame, row);
    node.appendChild(frame);
  }

  return node;
}

function show(rows) {
  cancelClear();
  const frag = document.createDocumentFragment();
  for (const row of rows) frag.appendChild(buildRow(row));
  stripImages(host);
  host.replaceChildren(frag);
  host.dataset.rooms = String(rows.length);
  host.dataset.shown = "1";
}

function hide() {
  host.dataset.shown = "0";
  /* The rows outlive the fade, or the surface empties itself in front of the
     room and THEN fades an empty rectangle. */
  cancelClear();
  clearTimer = setTimeout(() => {
    clearTimer = null;
    stripImages(host);
    host.replaceChildren();
    delete host.dataset.rooms;
  }, CLEAR_MS);
}

/**
 * One pass: read the house, write the glass only if the answer moved.
 *
 * @param {object} [opts]
 * @param {object|null} [opts.snapshot] inject the house rather than reading it.
 *        `undefined` reads the real one; `null` asserts an EMPTY house, and the
 *        two are deliberately different — see houseSnapshot's header.
 */
export function evaluateMediaRooms({ snapshot } = {}) {
  if (!host) return null;

  const house = snapshot === undefined ? houseSnapshot() : snapshot;
  const rows = roomsFrom(house);
  const next = signatureOf(rows);

  if (next !== signature) {
    signature = next;
    renders += 1;
    if (rows.length) show(rows);
    else hide();
  } else if (rows.length) {
    /* Same answer, but time has passed — and the CSS delay was written against
       the instant of the last DOM write. Re-anchoring costs two style property
       sets per row and no layout, and without it a surface that has been up for
       an hour would still be animating from where it started. */
    const nodes = host.children;
    for (let i = 0; i < rows.length && i < nodes.length; i += 1) {
      const carrier = nodes[i].querySelector(".mdisc, .mframe");
      if (carrier) applyProgress(carrier, rows[i]);
    }
  }

  last = {
    rooms: rows.map((r) => ({
      room: r.room,
      cell: r.cell,
      kind: r.kind,
      title: r.title,
      hasImage: Boolean(r.image),
      timed: Boolean(progressOf(r))
    })),
    shown: host.dataset.shown === "1",
    renders,
    at: new Date().toISOString()
  };
  return last;
}

function settle() {
  if (settleTimer) return;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    evaluateMediaRooms();
  }, SETTLE_MS);
}

/** The last verdict, for __v3(). Null before the first pass. */
export function mediaRoomsState() {
  return last;
}

/**
 * @returns {boolean} whether the surface is live. False when flag-off, which is
 *          no listener, no timer and no attribute — the flag-off build is the
 *          one that shipped before it, with core/now-playing.js still owning
 *          the corner.
 */
export function initMediaRooms() {
  if (!flag("v3MediaRooms")) return false;
  if (unsubscribe) return true;

  host = document.getElementById("media-rooms");
  if (!host) return false;

  /* Subscribed BEFORE anything reads: the SSE stream's opening snapshot is the
     only bulk fill there is, and a subscriber registered after it has missed
     the one event that says what is already playing. */
  unsubscribe = on("ha:state-updated", (entity) => {
    if (String(entity?.entity_id ?? "").startsWith("media_player.")) settle();
  });

  // Registered before the first pass, not after — a probe driving this over CDP
  // can arrive in that gap, and a hook that only exists once a load has settled
  // is a flake this repo has root-caused twice.
  window.__v3MediaRooms = () => mediaRoomsState();
  window.__v3MediaRoomsSet = (house) =>
    evaluateMediaRooms(house === undefined ? {} : { snapshot: house });

  recheckTimer = setInterval(() => evaluateMediaRooms(), RECHECK_MS);

  evaluateMediaRooms();
  return true;
}

/** Symmetric teardown. Exported for specs, which mount and unmount this many
 *  times in one page — the interval and the subscription are per-init and would
 *  otherwise accumulate. */
export function teardownMediaRooms() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  if (recheckTimer) clearInterval(recheckTimer);
  recheckTimer = null;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  cancelClear();
  if (host) {
    stripImages(host);
    host.replaceChildren();
    delete host.dataset.rooms;
    host.dataset.shown = "0";
  }
  host = null;
  signature = null;
  last = null;
}
