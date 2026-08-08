/* ═══════════════════════════════════════════════════════════════════════════
   MEDIA ARTWORK — one answer to "what URL does this album art actually live at".

   Home Assistant reports `entity_picture` as a path relative to HA itself
   (`/api/media_player_proxy/...`). The browser is talking to the dashboard, not
   to HA, so that path resolves to nothing here — it has to go through the
   server's image proxy first.

   ⚠ THIS WAS A REAL PARITY BUG, found building V3's media subject.
   `modules/mediaPanels.js` has always resolved the path before setting it on an
   <img>, so `focusHero`'s DOM scrape reads a WORKING url out of the rendered
   panel. `services/houseSnapshot.js` — the DOM-free replacement whose entire
   contract is to return the same values focusHero does — was reading
   `entity_picture` straight off the entity and handing the raw HA path to the
   media candidate. Nothing threw; the candidate simply carried an image that
   would never load, and it would have surfaced as "the artwork is broken on V3
   only" long after the cause was forgettable.

   So: one resolver, imported by both. Pure, DOM-free, no config.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {string|null|undefined} url  entity_picture, or anything else
 * @returns {string} a URL this browser can actually fetch, or "" for nothing
 */
export function resolveMediaImage(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;      // already absolute — Plex, art APIs
  if (!url.startsWith("/")) return url;        // a data: uri or a relative asset

  // Idempotent: re-resolving an already-proxied path must not double-prefix it.
  if (url.startsWith("/api/image_proxy")) return url;

  return `/api/image_proxy${url}`;
}
