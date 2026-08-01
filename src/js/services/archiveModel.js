import { captionParts, relativeYearPhrase } from "./photoMemory.js";

// The pure half of the Ambient Archive (docs/design/AMBIENT-ARCHIVE.md).
//
// Same discipline as dayModel.js: no DOM, no storage, no timers — so the
// decision that is easiest to get quietly wrong (what the plate is allowed to
// say) unit-tests in plain node. The renderer (modules/ambientArchive.js) reads
// live state and paints; this decides.

/**
 * What the plate says about the photograph on the card.
 *
 * The caption is already `year · place · who` — `captionFor` joins exactly
 * that — so the plate RELOCATES language the screensaver already renders in
 * Mode 0 rather than adding any (§6.4b).
 *
 * ⚠ Most of this library has no GPS and no named faces, so the caption is very
 * often a bare year and there is no place to put in the title. The plate still
 * speaks: it says the year in words. That is not invented data — the year is
 * already on the wall as a 400px engraving behind it — and it is the same
 * phrasing `buildOnThisDayMemory` uses. Shipped after 2026-08-02, when the
 * whole day's frozen set captioned as bare years and the plate never appeared.
 *
 * No year at all → null, and null means no plate: silence is the default.
 *
 * @returns {{year:string, title:string, who:string|null}|null}
 */
export function plateFor(caption, now = new Date()) {
  const named = caption ? /^\s*(\d{4})\b/.exec(String(caption)) : null;
  if (!named) return null;
  const year = named[1];
  const parts = captionParts(caption);
  const title = parts?.title ?? relativeYearPhrase(Number(year), now);
  if (!title) return null;
  return { year, title, who: parts?.who ?? null };
}

/**
 * The year a caption names, or null. The ghost engraving and the lit year-line
 * need only this — NOT the plate's parts. A photo with no place yields no
 * plate, and deriving the year from the plate is how the year vanished off the
 * wall entirely on 2026-08-02.
 */
export function yearOf(caption) {
  const named = caption ? /^\s*(\d{4})\b/.exec(String(caption)) : null;
  return named ? Number(named[1]) : null;
}
