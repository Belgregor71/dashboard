import { seasonOf } from "./houseModel.js";

// Turn Immich's on-this-day asset feed into a memory entry — Phase 9.5
// (docs/vision/photo-source-immich.md). Pure (its only import is the pure
// seasonOf), no DOM, no IO, so it unit-tests in plain node (tests/immich.spec.js).
// The server (immichClient) over-fetches assets in a ±1-day window per past year;
// THIS is where the exact "taken on today's month/day" match happens, on each
// asset's localDateTime (already local — no TZ conversion), plus dedupe + cap.
//
// Photos are referenced as { immich: id } so the renderer can tell an Immich
// asset (→ /api/immich/asset/:id/thumb) from an authored static path (a string).

const MAX_PHOTOS = 12;

function localMonthDay(iso) {
  // localDateTime is a wall-clock string ("2011-04-06T09:03:43.000Z"); read the
  // calendar fields directly, NOT via Date (which would apply a TZ offset).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * The wall-clock hour a photo was taken, as fractional hours since midnight.
 *
 * Same trap as `localMonthDay`, and it bites harder: `localDateTime` carries a
 * trailing `Z` it does not mean, so `new Date(s).getHours()` would shift a 9am
 * photo to 7pm in Brisbane — putting the Ambient Archive's lit year-mark ten
 * hours off on an axis whose whole job is being right about when. Read the
 * fields, never the Date.
 *
 * @returns {number|null} 0–24, or null when there is no usable time
 */
export function localHourOf(iso) {
  const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2]) / 60;
  return Number.isFinite(h) && h >= 0 && h <= 24 ? h : null;
}

/**
 * Assets actually taken on today's month/day, newest year first, deduped + capped.
 * @returns {Array<{id:string, year:number}>}
 */
export function photosForToday(assets, now = new Date()) {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const seen = new Set();
  const out = [];
  for (const a of assets || []) {
    const md = localMonthDay(a?.localDateTime);
    if (!md || md.month !== month || md.day !== day) continue;
    if (!a.id || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({ id: a.id, year: md.year });
  }
  out.sort((x, y) => y.year - x.year); // most recent year first
  return out.slice(0, MAX_PHOTOS);
}

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ── Daily Memories set (features.dailyMemories) ────────────────
// The curated per-day screensaver set: today's month/day across past years, and
// when that specific day is thin, widening to the NEAREST neighbouring dates
// (±1, ±2 … up to maxOffsetDays) until `target` photos are collected. Pure —
// the server (dailyMemories.js) runs this over the exif-carrying slimmed feed,
// then freezes the result. Real-Date arithmetic, so month boundaries / leap days
// are handled by construction (never month/day + N modular maths).

const MAX_OFFSET_DAYS = 8;

// Nearest-first list of {month, day, offset} around `now`: k=0, then the day
// before + after at k=1, and so on. Same-offset ties resolve day-before first.
function candidateDays(now, maxOffsetDays) {
  const out = [];
  for (let k = 0; k <= maxOffsetDays; k++) {
    const offsets = k === 0 ? [0] : [-k, k];
    for (const off of offsets) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
      out.push({ month: d.getMonth() + 1, day: d.getDate(), offset: Math.abs(off) });
    }
  }
  return out;
}

/**
 * Select the curated daily set from an exif-carrying asset feed.
 * @returns {Array<{id, year, hour, offsetDays, city, state, country, lat, lng}>}
 *          nearest day first, newest year first within a day, deduped, capped.
 *          `hour` is the wall-clock hour it was taken (null when unknown) — the
 *          Ambient Archive places its lit year-mark there.
 */
export function selectDailyMemories(assets, now = new Date(), { target = MAX_PHOTOS, maxOffsetDays = MAX_OFFSET_DAYS } = {}) {
  // Bucket assets by their local month/day (newest year first within a bucket).
  const byMd = new Map();
  for (const a of assets || []) {
    const md = localMonthDay(a?.localDateTime);
    if (!md || !a?.id) continue;
    const key = `${md.month}-${md.day}`;
    if (!byMd.has(key)) byMd.set(key, []);
    byMd.get(key).push({ ...a, year: md.year });
  }
  for (const list of byMd.values()) list.sort((x, y) => y.year - x.year);

  const seen = new Set();
  const out = [];
  for (const c of candidateDays(now, maxOffsetDays)) {
    if (out.length >= target) break;
    for (const a of byMd.get(`${c.month}-${c.day}`) || []) {
      if (out.length >= target) break;
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({
        id: a.id,
        year: a.year,
        hour: localHourOf(a.localDateTime),
        offsetDays: c.offset,
        city: a.city ?? null,
        state: a.state ?? null,
        country: a.country ?? null,
        lat: a.lat ?? null,
        lng: a.lng ?? null,
        people: a.people ?? []
      });
    }
  }
  return out;
}

// A photo is "travel" when it carries a country that isn't Australia — the gate
// for showing the small map tile. No country (no GPS) → not travel.
export function isTravel({ country } = {}) {
  return Boolean(country) && !/austral/i.test(String(country));
}

// Immich stores a person's name as whoever tagged the face typed it, which in
// this library is uniformly a full name ("Greg Dee", "Joe Perry-McHugh"). A
// caption wants what the house actually calls someone, so take the given name.
// It also merges Immich's duplicate person records for free: the live library
// carries both "Korina Newsome-Smith" and "Korina" for one person.
export function givenName(full) {
  return String(full || "").trim().split(/\s+/)[0] || "";
}

/**
 * The given names that CANNOT stand alone in a caption, because more than one
 * person in the library shares them. Live counts: three Marks (Sokes, Dee,
 * Weber), three Matts, two Laurens, two Megans — "Mark" names nobody in
 * particular, so those get their full name and everyone else stays informal.
 *
 * EVERY distinct record counts, including bare given-name ones. A bare "Korina"
 * beside "Korina Newsome-Smith" is a SECOND Korina whose surname nobody could
 * remember — not one person split across two face clusters. Same for the two
 * Andrews and the two Damians. (This was assumed the other way round on the
 * first pass and corrected: treating the bare record as a duplicate quietly
 * captioned two different people with the same name.)
 *
 * Two records with the SAME full name ("Chris" twice, two real people) still
 * resolve to one entry here, because nothing distinguishes them in a caption —
 * "Chris" is the best answer available for either.
 */
export function ambiguousGivenNames(allNames) {
  const byGiven = new Map();
  for (const raw of allNames || []) {
    const full = String(raw || "").trim().replace(/\s+/g, " ");
    const given = givenName(full);
    if (!given) continue;
    if (!byGiven.has(given)) byGiven.set(given, new Set());
    byGiven.get(given).add(full.toLowerCase());
  }

  const out = new Set();
  for (const [given, records] of byGiven) {
    if (records.size > 1) out.add(given);
  }
  return out;
}

// What a photo actually calls someone: the given name normally, the full name
// when that given name belongs to more than one person.
export function displayName(full, ambiguous) {
  const norm = String(full || "").trim().replace(/\s+/g, " ");
  const given = givenName(norm);
  if (!given) return "";
  return ambiguous?.has(given) ? norm : given;
}

// Two names read as a caption; a party's worth reads as a list. Measured against
// the live pool, 95% of named photos have one or two named faces anyway.
const MAX_NAMES = 2;

/**
 * The "· Joe and Lee" tail of a caption, or "" when there is no one worth naming.
 *
 * `hideNames` is who must NEVER be named, and it doubles as the switch for this
 * whole lane: with no one hidden there is no one to name *relative to*, so the
 * caption stays exactly what it was before names existed. That is deliberate —
 * in the live pool the two residents are in ~80 of the 91 named-face photos, so
 * naming everyone would label almost every photo with the pair standing in front
 * of the screen, which is the one thing they already know.
 *
 * Matching is on the FULL name, case-insensitively, NOT the given name: the
 * household has two Bretts (the vault's own family notes call this out), so
 * hiding "Brett Lewis" must not also silence Brett Abdul. Someone tagged under
 * more than one person record needs each of them listed.
 */
export function nameSegment(people, hideNames = [], ambiguous = new Set(), relationships = null) {
  // Both sides are free text a person typed — Immich's name field and a comma
  // list in .env — so compare them on one normal form rather than hoping they
  // were typed identically.
  const key = (n) => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();

  const hidden = new Set((hideNames || []).map(key).filter(Boolean));
  if (hidden.size === 0) return "";

  const found = [];
  for (const full of people || []) {
    if (hidden.has(key(full))) continue;
    // Dedupe on what will actually be SHOWN, so two records that render the
    // same word never say it twice.
    const shown = displayName(full, ambiguous);
    if (shown && !found.some((f) => f.shown === shown)) found.push({ full, shown });
  }
  const names = found.map((f) => f.shown);

  if (names.length === 0) return "";

  if (names.length === 1) {
    // What the house calls them, but ONLY when they have the photo to
    // themselves. "our niece Melanie" is a warm aside; "our niece Melanie and
    // our nephew Symon" is an inventory, and this caption stays a whisper.
    const label = relationships?.get(key(found[0].full));
    // A relationship disambiguates harder than a surname does — "Brett's
    // brother Matt" is unmistakable and "Brett's brother Matt Lewis" is just
    // long — so a labelled name drops back to the given name.
    return label ? `${label} ${givenName(found[0].full)}` : names[0];
  }

  if (names.length <= MAX_NAMES) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  const rest = names.length - MAX_NAMES;
  return `${names.slice(0, MAX_NAMES).join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
}

// The subtle bottom-left caption: "year · place, region · who". Region is the
// country for overseas photos, else the state (so "2019 · Kyoto, Japan" but
// "2018 · Byron Bay, NSW"). Names come last, the quietest element, and are
// absent far more often than not. Every part falls away independently: a photo
// with no GPS and no named face is still just its bare year.
export function captionFor(
  { year, city, state, country, people } = {},
  { hideNames = [], ambiguous, relationships } = {}
) {
  const region = isTravel({ country }) ? country : (state || null);
  const place = [city, region].filter(Boolean).join(", ");
  return [year ?? "", place, nameSegment(people, hideNames, ambiguous, relationships)]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Split a caption back into its registers — the inverse of `captionFor`.
 *
 * The Ambient Archive's plate is `year · place · who`, and that is exactly what
 * `captionFor` already joins, which is why the plate is RELOCATED language and
 * not new language (AMBIENT-ARCHIVE.md §6.4b). Nothing is invented here: a
 * caption carrying only a year yields null, and null means the plate does not
 * appear at all, because silence is the default.
 *
 * @returns {{year:string, title:string, who:string|null}|null}
 */
export function captionParts(caption) {
  const parts = String(caption ?? "")
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const [year, title, ...rest] = parts;
  return { year, title, who: rest.join(" · ") || null };
}

/**
 * A memory photo ref → a URL, or null when there's no ref. Immich assets are
 * { immich: id }; authored entries are string paths (absolute/rooted as-is,
 * bare names under /photos/).
 */
export function memoryPhotoSrc(ref) {
  if (ref && typeof ref === "object" && ref.immich) {
    return `/api/immich/asset/${encodeURIComponent(ref.immich)}/thumb`;
  }
  const s = String(ref ?? "");
  if (!s) return null;
  if (/^(https?:|\/)/.test(s)) return s;
  return `/photos/${s.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Build a single "on this day" memory entry from the Immich feed, or null when
 * there's nothing from a past year today. Anchored to today so pickMemory scores
 * it as an anniversary; photos are the past-years images (renderer shows one).
 */
export function buildOnThisDayMemory(assets, now = new Date()) {
  const photos = photosForToday(assets, now);
  if (photos.length === 0) return null;

  // Past-years only (the server queries prior years), so the oldest is >= 1 year
  // ago; name it from the oldest for the most evocative reach ("7 years ago").
  const oldest = photos[photos.length - 1].year;
  const yearsAgo = Math.max(1, now.getFullYear() - oldest);
  const title = `${yearsAgo} year${yearsAgo === 1 ? "" : "s"} ago`;

  return {
    id: `immich-otd:${dateKey(now)}`,
    kind: "photo",
    recurring: { month: now.getMonth() + 1, day: now.getDate() },
    title,
    tags: [seasonOf(now)],
    photos: photos.map((p) => ({ immich: p.id })),
    sensitivity: "normal",
    cooldownMonths: 6
  };
}
