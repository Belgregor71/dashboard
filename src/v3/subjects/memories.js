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

   ✅ **THE DESIGN DECISION, Stage 3 — CURATION, NOT A THIRD HEURISTIC.**
   This file asked for a decision rather than a rule, and the answer already
   existed on the box: 73 memories the household AUTHORED through Memory Studio,
   every one photo-anchored and titled in a person's own words, which nothing
   had read since the V3 cutover severed `initMemoryRuntime` from the boot.

   So the year now LEADS with what someone chose and only FILLS with what the
   camera happened to catch. A supplement bottle can still appear in the tail of
   the 3×3 — the pool is what it is — but it can no longer be the whole screen,
   and it can never outrank a photograph a person wrote a sentence about.

   That is deliberately not a filter. immichClient's own comment block records
   two aggressive filters that were built, looked exact, and were rejected on
   evidence for dropping real memories; a third would have been the same mistake
   with better manners. Nothing is excluded here. Something is PREFERRED.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, plate, getJson } from "./dom.js";
import { placeUnlessEchoed } from "../core/ground.js";
import { anniversaryToday } from "../../js/services/memoryEngine.js";
import { memoryPhotoSrc } from "../../js/services/photoMemory.js";

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
  const trip = String(asset?.trip || "").trim();
  const parts = [
    yearsAgo(assetDate(asset), now),
    placeUnlessEchoed(String(asset?.city || "").trim(), trip),
    trip
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const curatedEnabled = () => Boolean(globalThis.window?.CONFIG?.features?.v3CuratedYear);

/**
 * Today's authored memories, as plates — the household's own writing, chosen
 * rather than caught.
 *
 * Read straight off `/api/memories` rather than through the memory runtime,
 * because the runtime's job is the opposite of this one: it rations. It surfaces
 * AT MOST ONE memory per day through the attention queue, spends a budget, and
 * honours months-long cooldowns — all correct for an unasked-for line on a quiet
 * wall, all wrong for a screen somebody just asked to see. "Show me the year" is
 * a request, and a request is not rationed.
 *
 * ⚠ A TENDER ENTRY IS SHOWN BUT NEVER NARRATED. `memoryEngine.toSurface` makes
 * exactly one rule about `sensitivity: "tender"` — `caption: null`, because the
 * house does not put grief into words — and this honours it rather than
 * inventing an exception for a screen that was asked for. 12 of the 73 authored
 * memories are tender, and the very next curated day (20 August, "Boof loved
 * his bear", 2006) is one of them, so this is not a hypothetical.
 *
 * The photograph still appears and still says how long ago it was. What it does
 * not do is read the sentence somebody wrote about a dog that died.
 */
function curatedPlates(memories, now) {
  const out = [];
  for (const entry of memories) {
    if (!entry?.id || !anniversaryToday(entry, now)) continue;
    const when = yearsAgo(entry.date, now);
    const tender = entry.sensitivity === "tender";
    const caption = tender
      ? when
      : [when, String(entry.title ?? "").trim()].filter(Boolean).join(" · ");
    for (const ref of Array.isArray(entry.photos) ? entry.photos : []) {
      const src = memoryPhotoSrc(ref);
      // The Immich id, so the raw fill below cannot show the same photograph
      // twice — once with the household's words and once with a bare year.
      const id = ref && typeof ref === "object" ? ref.immich : null;
      if (src) out.push({ src, caption: caption || null, id });
    }
  }
  return out;
}

export async function showYear({ now = new Date() } = {}) {
  /* Both at once. The curated read is a small local file and the Immich one is a
     NAS that sleeps, so serialising them would put the whole depth-3 open behind
     the slower of the two for no reason. Neither can reject — getJson answers
     null — so there is nothing here for Promise.all to lose. */
  const [data, authored] = await Promise.all([
    getJson("/api/immich/on-this-day"),
    curatedEnabled() ? getJson("/api/memories") : Promise.resolve(null)
  ]);

  /* Immich unconfigured or unreachable answers { assets: [] }, and so does a
     date nobody has ever photographed. Neither is a screen worth taking the
     surface to depth 3 for — but a day with curated memories IS, even with
     Immich down, which is the whole point of leading with the local store. */
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const memories = Array.isArray(authored?.memories) ? authored.memories : [];
  const curated = curatedPlates(memories, now);
  if (assets.length === 0 && curated.length === 0) return null;

  const { node, teardown } = frame("year");
  node.dataset.cell = "memories";
  node.appendChild(title(now.toLocaleDateString("en-AU", { day: "numeric", month: "long" })));

  const grid = document.createElement("div");
  grid.className = "subject__plates";

  // What somebody chose, first and in full.
  const spoken = new Set();
  for (const item of curated.slice(0, MAX_PLATES)) {
    if (item.id) spoken.add(item.id);
    grid.appendChild(plate(item.src, item.caption));
  }

  // Then what the camera caught, to fill the 3×3 — never to displace the above.
  for (const asset of assets) {
    if (grid.childElementCount >= MAX_PLATES) break;
    const id = asset?.id ?? asset?.assetId;
    if (!id || spoken.has(id)) continue;
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
