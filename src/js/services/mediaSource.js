/* ═══════════════════════════════════════════════════════════════════════════
   MEDIA SOURCE — one answer to "is this player actually playing MEDIA".

   Owner's call, 2026-08-09: when the Sonos is carrying TV audio, the house is
   not to display it as what's playing.

   ── Why this is its own module ─────────────────────────────────────────────

   The same reason `mediaImage.js` is. Three different things decide whether
   something is "now playing" in this house, and they do not share a code path:

     modules/mediaPanels.js    the INCUMBENT's two panels — and the incumbent is
                               what the kiosk serves at `/`, so this is the
                               surface the household actually looks at. Its
                               attention candidate is then SCRAPED from the
                               rendered panel by focusHero, so hiding the panel
                               removes the candidate for free.
     services/houseSnapshot.js the DOM-free reader — V3's band, V3's depth-3
                               subject, and V3's attention queue.
     services/voiceSnapshot.js the fast lane's spoken answer.

   A rule about what counts as media that lived in only one of them would be a
   house that says one thing on the wall and another out loud. mediaImage.js's
   header records exactly that bug being shipped once already — the resolver
   existed in the panel and not in the snapshot, so V3 carried an artwork URL
   that could never load, silently, for weeks.

   ── What TV audio actually looks like, measured ─────────────────────────────

   Read off the live house on 2026-08-09 rather than guessed, because the memory
   of this house is that the Apple TV entities lie about precisely this
   (`media_player.piano_room_tv*` sat `unavailable` WHILE TV audio played):

     media_player.living_room   source_list ["TV", "12\" Classics", "Always
                                Perfect", ...] — ONE input named "TV" and every
                                other member a music service. In TV mode it
                                carries no media_title, no artist and no
                                entity_picture at all.
     media_player.piano_room    source "Spotify Connect", with title, artist,
                                album and artwork.

   So the match is exact and lower-cased, not a substring or a guess: a station
   called "TV Radio" is a music service and must keep playing. If another
   non-media input is ever wired up (optical, HDMI, a second TV) it will appear
   as a new entry in that same `source_list`, and it belongs in the set below.

   ⚠ AND THE `source` TEST IS THE WHOLE TEST. Do not be tempted to add "…or it
   has no media_title" — a player that is genuinely mid-track between metadata
   updates has no title either, and the two are not the same thing.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Inputs that are sound coming out of the speaker, but are not MEDIA the house
 *  can name, picture, or sensibly say out loud. Lower-case; compared exactly. */
export const NON_MEDIA_SOURCES = new Set(["tv"]);

/**
 * @param {{attributes?: {source?: string}}|null|undefined} entity  an HA media_player
 * @returns {boolean} true when this player is carrying TV audio
 */
export function isTvAudio(entity) {
  return NON_MEDIA_SOURCES.has(String(entity?.attributes?.source ?? "").trim().toLowerCase());
}
