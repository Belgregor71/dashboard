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

   ⚠ The ground photo's missing content filter (V3-MIGRATION, step 5.2) applies
   here too and is worse in one way: the ground shows one asset, this shows
   nine. A screenshot of a parcel-locker website is embarrassing once on the
   ground and nine times here. The fix belongs upstream in immichClient, not in
   a filter bolted on at this end — noted so it is not re-diagnosed here.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, plate, getJson } from "./dom.js";

/* Nine plates in a 3x3. More than that and each one is below the size at which
   a photograph is worth showing rather than listing. */
const MAX_PLATES = 9;

/** "3 years ago" / "last year" / null when we cannot date it. Exported because
 *  the phrasing is the only judgement in this file. */
export function yearsAgo(takenAt, now = new Date()) {
  const d = new Date(takenAt);
  if (!Number.isFinite(d.getTime())) return null;
  const years = now.getFullYear() - d.getFullYear();
  if (years <= 0) return "this year";
  if (years === 1) return "last year";
  return `${years} years ago`;
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
      yearsAgo(asset?.takenAt ?? asset?.fileCreatedAt, now)
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
