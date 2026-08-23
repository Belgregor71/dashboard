/* ═══════════════════════════════════════════════════════════════════════════
   WHAT'S PLAYING — depth 3. "show me what's playing."

   The incumbent has two media panels and a Plex tile. This has one screen: the
   artwork, full bleed, with the title over it. That is what "one thing, at
   editorial scale" means for music — the album cover IS the answer, and a
   panel with a 90px thumbnail in the corner of it never was.

   ── Where the data comes from, and why not from the voice snapshot ──────────

   `voiceSnapshot.media` is shaped for SPEECH: title and artist, no artwork,
   deliberately, because the fast lane must never hold an image URL it has no
   use for. `houseSnapshot` is the shape with the picture in it, it is
   synchronous, it is already cached, and it is the same reader the attention
   queue uses — so the subject and the candidate can never disagree about what
   is playing.

   Plex is the fallback rather than the primary: a media_player entity is the
   live state of a device in this house, whereas a Plex session is a stream that
   may be playing on someone's phone at work.

   ⚠ THE PRECEDENCE IS IMPORTED, NOT REPEATED. It started here and the ambient
   band (core/now-playing.js) took a copy of it; the copy then learned two
   things this file never did — that a Plex session names the ROOM it is playing
   in (`plexSub`, "Lounge Room TV"), and that "Playing" is the shared fallback
   when nothing names the source. So until 2026-08-15 the band on the resting
   wall and the depth-3 subject summoned by voice could describe the same stream
   differently: the band said where it was playing and the subject said
   "Playing". Two readers of one snapshot must not disagree about it — which is
   the reason `houseSnapshot` exists at all.

   ── The rooms rebuild, 2026-08-23 ───────────────────────────────────────────

   With `v3MediaRooms` on, the reader is `houseSnapshot().mediaRooms` — the same
   per-room rows the depth-0 band draws — and this becomes the deepest rung of a
   gradient that used to run BACKWARDS. The owner's report was that going deeper
   showed LESS: a bigger title and nothing else. So this depth is the one that
   owes the most, and it now adds what no shallower surface has room for:

     · the record at editorial scale, still turning, still one revolution per
       track — the owner asked for it at every level
     · the album, the playlist and the queue, which exist only here
     · the CLOCK, spelled out — depth 0 has no numbers at all and depth 2 has
       elapsed and remaining; this is the only place the full duration appears
     · THE OTHER ROOM, kept in view rather than replaced. Summoning one room's
       music must not make the house forget the film playing next door.

   Flag-off falls through to `playingFrom` exactly as before, so the subject a
   rollback restores is the one that shipped.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, column } from "./dom.js";
import { playingFrom } from "../core/now-playing.js";
import { formatClock, progressOf, roomsFrom } from "../core/media-rooms.js";
import { houseSnapshot } from "../../js/services/houseSnapshot.js";

function flag(name) {
  return Boolean(globalThis.window?.CONFIG?.features?.[name]);
}

const SVG_NS = "http://www.w3.org/2000/svg";
/* r=222 in a 460 box; the dasharray is derived so the ring cannot disagree with
   the geometry it is drawn on. */
const HERO_R = 222;
const HERO_C = 2 * Math.PI * HERO_R;

/** The record, at editorial scale. Same one-revolution-per-track animation the
 *  band uses, driven by the same negative delay — so the two surfaces cannot
 *  show the same song at two different positions. */
function record(row) {
  const wrap = document.createElement("div");
  wrap.className = "subject__record";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "subject__ring");
  svg.setAttribute("viewBox", "0 0 460 460");
  svg.setAttribute("aria-hidden", "true");
  for (const cls of ["subject__ring-track", "subject__ring-fill"]) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("class", cls);
    circle.setAttribute("cx", "230");
    circle.setAttribute("cy", "230");
    circle.setAttribute("r", String(HERO_R));
    if (cls.endsWith("fill")) {
      circle.setAttribute("stroke-dasharray", String(HERO_C.toFixed(2)));
      circle.setAttribute("stroke-dashoffset", String(HERO_C.toFixed(2)));
    }
    svg.appendChild(circle);
  }
  wrap.appendChild(svg);

  const plate = document.createElement("div");
  plate.className = "subject__plate-disc";
  if (row.image) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = row.image;
    img.addEventListener("error", () => { img.dataset.blank = "1"; }, { once: true });
    plate.appendChild(img);
  }
  wrap.appendChild(plate);

  const spindle = document.createElement("div");
  spindle.className = "subject__spindle";
  wrap.appendChild(spindle);

  const p = progressOf(row);
  if (p) {
    wrap.dataset.timed = "1";
    wrap.style.setProperty("--dur", `${p.duration}s`);
    wrap.style.setProperty("--delay", `-${p.elapsed}s`);
    wrap.style.setProperty("--prog", String(p.fraction));
    wrap.style.setProperty("--ring-c", String(HERO_C.toFixed(2)));
  }
  return wrap;
}

/**
 * The quiet detail under the title: how far through, the album, the playlist.
 *
 * ⚠ ONE LINE AT --t-rail, NOT ROWS THROUGH column(). MEASURED, and it was wrong
 * in the first cut: `column()` sets every row in the SAID voice at --t-said-2
 * (96px), so three facts added ~350px to the caption and pushed it to 491px
 * above the floor — past the 298px plateau of the band that
 * `.subject--media::after` provides, which compose.css:569 states in as many
 * words was "SIZED TO THE TALLEST CAPTION, NOT TO TASTE". The title stayed
 * legible and the facts sat on bare photograph.
 *
 * It was also simply the wrong voice. A playlist name at 96px competes with the
 * track for the eye; these are the things you read second, and they should look
 * like it. One tracked line at the type floor says the same thing and costs the
 * caption ~40px.
 *
 * Only what the source actually reported — a missing album contributes nothing,
 * never an em dash, because a wall that prints "Album —" has said something
 * untrue about the record.
 *
 * @returns {string} possibly empty
 */
export function factsLine(row) {
  const parts = [];
  const p = progressOf(row);
  if (p) {
    const elapsed = formatClock(p.elapsed, row?.contentType);
    const total = formatClock(p.duration, row?.contentType);
    if (elapsed && total) parts.push(`${elapsed} of ${total}`);
  }
  if (row?.album && row.album !== row.title) parts.push(row.album);
  if (row?.playlist) parts.push(row.playlist);
  return parts.join(" · ");
}

/** The rooms this one is NOT. Summoning the piano room's music must not make
 *  the house forget the film in the lounge. */
function elsewhere(rows, shown) {
  const others = rows.filter((r) => r !== shown);
  if (!others.length) return null;
  const wrap = document.createElement("div");
  wrap.className = "subject__elsewhere";
  for (const row of others) {
    const line = document.createElement("p");
    line.className = "subject__elsewhere-line measured";
    const remaining = (() => {
      const p = progressOf(row);
      if (!p) return null;
      return formatClock(p.duration - p.elapsed, row.contentType);
    })();
    // textContent, never innerHTML — every part of this is upstream data.
    line.textContent = remaining
      ? `Also · ${row.room} · ${row.title} · −${remaining}`
      : `Also · ${row.room} · ${row.title}`;
    wrap.appendChild(line);
  }
  return wrap;
}

export function showMedia({ snapshot = null } = {}) {
  const house = snapshot ?? houseSnapshot();

  if (flag("v3MediaRooms")) {
    const rows = roomsFrom(house);
    /* Nothing playing is a real answer, but it is a SPOKEN one — the fast lane
       already says "nothing's playing" in a fifth of a second. Taking the whole
       screen to show an empty rectangle saying the same thing is the opposite
       of calm, so this falls through and voice.js speaks the sentence. */
    if (!rows.length) return null;

    /* The first room in config order. The voice asked "what's playing", not
       "what is playing in the piano room" — deixis for a specific room is a
       separate question and would arrive as a different command. */
    const row = rows[0];
    const { node, teardown } = frame("media");
    node.dataset.cell = row.cell;
    node.dataset.kind = row.kind;

    if (row.kind === "music") {
      node.appendChild(record(row));
    } else if (row.image) {
      const art = document.createElement("img");
      art.className = "subject__frame subject__art";
      art.alt = "";
      art.src = row.image;
      /* An artwork URL that 404s must not leave a broken-image glyph at 1920px.
         The CLASS is removed rather than the node, so the teardown's src sweep
         still finds it — a node removed here would keep its connection. */
      art.addEventListener("error", () => art.classList.add("is-blank"), { once: true });
      node.appendChild(art);
    }

    const caption = document.createElement("div");
    caption.className = "subject__over";
    // The ROOM is the eyebrow. It is the whole point of the rebuild: a Plex
    // client name ("Apple TV", "Edge") is not a place anything is playing.
    caption.appendChild(title(row.meta ? `${row.room} · ${row.meta}` : row.room));
    caption.appendChild(column([{ text: row.title }]));
    const facts = factsLine(row);
    if (facts) {
      const line = document.createElement("p");
      line.className = "subject__facts measured";
      line.textContent = facts;   // textContent, never innerHTML — upstream data
      caption.appendChild(line);
    }
    node.appendChild(caption);

    const others = elsewhere(rows, row);
    if (others) node.appendChild(others);

    return { node, teardown };
  }

  const playing = playingFrom(house);
  if (!playing) return null;

  const { node, teardown } = frame("media");
  node.dataset.cell = playing.cell;

  if (playing.image) {
    const art = document.createElement("img");
    art.className = "subject__frame subject__art";
    art.alt = "";
    art.src = playing.image;
    art.addEventListener("error", () => art.classList.add("is-blank"), { once: true });
    node.appendChild(art);
  }

  const caption = document.createElement("div");
  caption.className = "subject__over";
  // `playingFrom` guarantees a sub — the shared "Playing" fallback lives there.
  caption.appendChild(title(playing.sub));
  caption.appendChild(column([{ text: playing.title }]));
  node.appendChild(caption);

  return { node, teardown };
}
