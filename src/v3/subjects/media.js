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
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, column } from "./dom.js";
import { houseSnapshot } from "../../js/services/houseSnapshot.js";

export function showMedia({ snapshot = null } = {}) {
  const house = snapshot ?? houseSnapshot();

  const playing = house?.nowPlayingActive
    ? { title: house.nowPlayingTitle, sub: house.nowPlayingSub, image: house.nowPlayingImage, cell: "nowPlaying" }
    : house?.plexActive
      ? { title: house.plexText, sub: null, image: house.plexImage, cell: "plex" }
      : null;

  // Nothing playing is a real answer, but it is a SPOKEN one — the fast lane
  // already says "nothing's playing" in a fifth of a second. Taking the whole
  // screen to depth 3 to show an empty rectangle saying the same thing is the
  // opposite of calm, so this falls through instead.
  if (!playing?.title) return null;

  const { node, teardown } = frame("media");
  node.dataset.cell = playing.cell;

  if (playing.image) {
    const art = document.createElement("img");
    art.className = "subject__frame subject__art";
    art.alt = "";
    art.src = playing.image;
    /* An artwork URL that 404s must not leave a broken-image glyph at 1920px.
       The class is removed rather than the node, so the teardown's src-clearing
       sweep still finds it — a node removed here would keep its connection. */
    art.addEventListener("error", () => art.classList.add("is-blank"), { once: true });
    node.appendChild(art);
  }

  const caption = document.createElement("div");
  caption.className = "subject__over";
  caption.appendChild(title(playing.sub || "Playing"));
  caption.appendChild(column([{ text: playing.title }]));
  node.appendChild(caption);

  return { node, teardown };
}
