/* ═══════════════════════════════════════════════════════════════════════════
   THE YEAR — depth 3. "show me the year."

   §11 of the V3 plan calls this one of the two most delightful ideas in the
   whole thing and the least specified, and says it deserves a design pass
   rather than a table row. That pass has not happened, so this is deliberately
   the restrained version: the photographs Immich already knows were taken on
   this date in other years, captioned with how long ago that was.

   Restrained, but not a placeholder — "on this day" is real, dated, and needs
   no new endpoint, no new model call and no taste. Whatever the design pass
   eventually decides the year should BE, it will still want these photographs
   in it.

   ⚠ **WHAT THE WALL ACTUALLY SHOWED, and it was NOT the predicted defect.**
   Seen 2026-08-08: nine plates, seven lovely border collie photographs, plus a
   product shot of two supplement bottles and a close-up of a sandwich.

   The predicted problem was SCREENSHOTS (step 5.2, the parcel-locker website on
   the ground). That filter already exists in `server/services/immichClient.js`
   as `isScreenshot()`, it is already enabled live via
   `IMMICH_EXCLUDE_SCREENSHOTS=1`, and it is working — neither offender is a
   screenshot. They are real photographs of unremarkable things, which no
   pixel-dimension rule can or should catch.

   So this is a DIFFERENT and harder problem than 5.2, and it wants a design
   decision rather than a heuristic. `slim()` already carries a `people` array,
   and a photograph with a recognised face is almost definitionally a memory
   where a supplement bottle is not — but immichClient's own comment block
   records two aggressive filters that were built, looked exact, and were
   rejected on evidence for dropping real memories. Do not add a third without
   sampling the library first. Left deliberately unfiltered until then.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, plate, getJson } from "./dom.js";

/* Nine plates in a 3x3. More than that and each one is below the size at which
   a photograph is worth showing rather than listing. */
const MAX_PLATES = 9;

/** "3 years ago" / "last year" / null when we cannot date it. Exported because
 *  the phrasing is the only judgement in this file. */
export function yearsAgo(takenAt, now = new Date()) {
  /* ⚠ `new Date(null)` is THE EPOCH, not an invalid date — so a null slips
     straight past a `Number.isFinite(getTime())` guard and captions an undated
     photograph "56 years ago". `new Date(undefined)` IS invalid, which is why
     the first version of this looked correct and was tested as correct. Reject
     the absent value before constructing anything. */
  if (takenAt == null || takenAt === "") return null;
  const d = new Date(takenAt);
  if (!Number.isFinite(d.getTime())) return null;
  const years = now.getFullYear() - d.getFullYear();
  if (years <= 0) return "this year";
  if (years === 1) return "last year";
  return `${years} years ago`;
}

/* ⚠ SEEN ON THE WALL, 2026-08-08: nine photographs, NOT ONE CAPTION.
   The field is `localDateTime`. This file was written against `takenAt` /
   `fileCreatedAt`, which are what the Immich REST asset carries — but this route
   does not return a raw asset, it returns `slim(a)`, and slim renames things.
   `yearsAgo` correctly answered null for every plate and the caption was
   omitted, so the ONE THING the subject is about — how long ago this was —
   silently did not render. Nothing threw and the screen looked deliberate.

   The lesson is the cheap one: READ THE ENDPOINT, do not infer its shape from
   the upstream API it wraps. The real names are checked first and the guesses
   are kept only as fallbacks. */
const DATE_KEYS = ["localDateTime", "takenAt", "fileCreatedAt"];

export function assetDate(asset) {
  for (const key of DATE_KEYS) {
    if (asset?.[key]) return asset[key];
  }
  return null;
}

/** "9 years ago · Playa del Carmen · Mexico 2017". The place is why an old photo
 *  is worth a second look, `slim()` carries city/state alongside the date at no
 *  extra cost, and `trip` is the vault's answer to what the day WAS
 *  (server/services/photoTrips.js — absent on almost every photograph).
 *
 *  Unlike the ground's caption, the trip is ADDED here rather than replacing
 *  anything: this line's first segment is "how long ago", not a year, so the
 *  two never say the same thing twice. */
export function captionFor(asset, now = new Date()) {
  const parts = [
    yearsAgo(assetDate(asset), now),
    String(asset?.city || "").trim(),
    String(asset?.trip || "").trim()
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export async function showYear({ now = new Date() } = {}) {
  const data = await getJson("/api/immich/on-this-day");

  /* Immich unconfigured or unreachable answers { assets: [] }, and so does a
     date nobody has ever photographed. Neither is a screen worth taking the
     surface to depth 3 for, so both fall through — the difference matters for
     diagnosis, not for what the room sees. */
  const assets = Array.isArray(data?.assets) ? data.assets : null;
  if (!assets || assets.length === 0) return null;

  const { node, teardown } = frame("year");
  node.dataset.cell = "memories";
  node.appendChild(title(now.toLocaleDateString("en-AU", { day: "numeric", month: "long" })));

  const grid = document.createElement("div");
  grid.className = "subject__plates";
  for (const asset of assets.slice(0, MAX_PLATES)) {
    const id = asset?.id ?? asset?.assetId;
    if (!id) continue;
    grid.appendChild(plate(
      `/api/immich/asset/${encodeURIComponent(id)}/thumb`,
      captionFor(asset, now)
    ));
  }

  // Every asset could have been malformed, in which case there is no subject
  // here — and an empty grid at depth 3 is the black screen the composer spent
  // a whole review catching.
  if (grid.childElementCount === 0) {
    teardown();
    return null;
  }

  node.appendChild(grid);
  return { node, teardown };
}
