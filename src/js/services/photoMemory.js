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
 * @returns {Array<{id, year, offsetDays, city, state, country, lat, lng}>}
 *          nearest day first, newest year first within a day, deduped, capped.
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
        offsetDays: c.offset,
        city: a.city ?? null,
        state: a.state ?? null,
        country: a.country ?? null,
        lat: a.lat ?? null,
        lng: a.lng ?? null
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

// The subtle bottom-left caption: "year · place, region". Region is the country
// for overseas photos, else the state (so "2019 · Kyoto, Japan" but "2018 · Byron
// Bay, NSW"). Falls back to place/region alone when one is missing, and to the
// bare year when there's no location at all (many photos lack GPS).
export function captionFor({ year, city, state, country } = {}) {
  const region = isTravel({ country }) ? country : (state || null);
  const place = [city, region].filter(Boolean).join(", ");
  return place ? `${year} · ${place}` : `${year ?? ""}`.trim();
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
