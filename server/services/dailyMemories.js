import { readFile, writeFile, mkdir, readdir, stat, unlink } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { fetchWithTimeout } from "../utils/fetch.js";
import { isConfigured, memoriesFeed, fetchRendition } from "./immichClient.js";
import { selectDailyMemories, captionFor, isTravel } from "../../src/js/services/photoMemory.js";

// Daily Memories screensaver set — features.dailyMemories.
// Picks a stable ~12-photo "on this day" set per day (today's month/day across
// past years, widened to the nearest neighbouring dates when a day is thin), and
// FREEZES it to disk so it serves all day even after the NAS sleeps. A once-an-
// hour scheduler (initDailyMemories) ensures today's set exists and, after the
// evening hour, pre-builds + cache-warms TOMORROW's set while the NAS is awake.
//
// Everything is fail-soft: unconfigured/unreachable Immich → an empty set that is
// NOT frozen (so it retries), and the client falls back to the random draw.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", "data", "immich-cache"); // shared thumb cache
const DAILY_DIR = path.join(CACHE_DIR, "daily");                            // frozen sets + map tiles

const TARGET = 12;
const MAX_OFFSET_DAYS = 8;      // how far either side of the day we'll reach for 12
const EVENING_HOUR = 21;        // ≥ this local hour → pre-build tomorrow (NAS still awake)
const TIMEOUT_MS = 6000;
const DAILY_MAX_FILES = 300;    // bound the daily dir (map tiles recur; sets are tiny)

// ── env (quote-stripping, the .env gotcha) ─────────────────────
function envVal(key) {
  const raw = process.env[key];
  return raw ? raw.trim().replace(/^["']|["']$/g, "") : null;
}

export function hasMapKey() {
  return envVal("MAP_API_KEY") != null;
}

// Mapbox Static Images API — a small dark map with a pin at the photo's coords.
// One helper so the provider is swappable; the token stays server-side (the
// browser only ever hits our /api/immich/map proxy).
function mapProviderUrl(lat, lng) {
  const key = envVal("MAP_API_KEY");
  if (key == null || lat == null || lng == null) return null;
  const style = envVal("MAP_STYLE") || "dark-v11";
  const pin = `pin-s+e8b64b(${lng},${lat})`;
  return `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${pin}/${lng},${lat},3/240x160@2x?access_token=${encodeURIComponent(key)}`;
}

// ── paths / small io ───────────────────────────────────────────
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const setFile = (date) => path.join(DAILY_DIR, `daily-set-${date}.json`);
const mapKey = (lat, lng) => `${Number(lat).toFixed(3)}_${Number(lng).toFixed(3)}`.replace(/[^0-9._-]/g, "");
const mapFile = (lat, lng) => path.join(DAILY_DIR, `map-${mapKey(lat, lng)}.jpg`);

// LRU-bound the daily dir (best-effort — the 24/7 kiosk failure mode is unbounded
// growth, same discipline as the thumb cache's pruneCache).
async function pruneDaily() {
  try {
    const files = await readdir(DAILY_DIR);
    if (files.length <= DAILY_MAX_FILES) return;
    const withTimes = await Promise.all(
      files.map(async (f) => ({ f, t: (await stat(path.join(DAILY_DIR, f))).mtimeMs }))
    );
    withTimes.sort((a, b) => a.t - b.t);
    const drop = withTimes.slice(0, withTimes.length - DAILY_MAX_FILES);
    await Promise.all(drop.map(({ f }) => unlink(path.join(DAILY_DIR, f)).catch(() => {})));
  } catch { /* best-effort */ }
}

// ── map tile (proxy + disk cache) ──────────────────────────────
/** A cached static map tile for [lat,lng], or null (no key / unreachable). */
export async function getMapTile(lat, lng) {
  if (!mapProviderUrl(lat, lng)) return null;
  const file = mapFile(lat, lng);
  try {
    return { contentType: "image/jpeg", buffer: await readFile(file) };
  } catch { /* miss → fetch */ }
  try {
    const res = await fetchWithTimeout(mapProviderUrl(lat, lng), {}, TIMEOUT_MS);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(DAILY_DIR, { recursive: true });
    await writeFile(file, buffer);
    void pruneDaily();
    return { contentType: res.headers.get("content-type") || "image/jpeg", buffer };
  } catch {
    return null;
  }
}

// Warm a rendition into the SHARED thumb cache (the path /api/immich/asset/:id/thumb
// reads) so it serves with the NAS asleep. Skips when already cached.
async function warmRendition(id) {
  const file = path.join(CACHE_DIR, `${id}.jpg`);
  try { await stat(file); return; } catch { /* not cached → fetch */ }
  const rendition = await fetchRendition(id, "preview");
  if (!rendition) return;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, rendition.buffer);
  } catch { /* best-effort */ }
}

async function warmSet(set) {
  for (const p of set.photos) {
    await warmRendition(p.id);           // sequential — gentle on the NAS
    if (p.map) await getMapTile(p.lat, p.lng);
  }
}

// ── build / freeze ─────────────────────────────────────────────
async function buildDailySet(now, { warm = false } = {}) {
  const date = ymd(now);
  if (!isConfigured()) return { date, photos: [] };

  const feed = await memoriesFeed(now, { halfWindowDays: MAX_OFFSET_DAYS });
  const selected = selectDailyMemories(feed, now, { target: TARGET, maxOffsetDays: MAX_OFFSET_DAYS });
  const photos = selected.map((p) => ({
    id: p.id,
    year: p.year,
    caption: captionFor(p),
    map: isTravel(p) && p.lat != null && p.lng != null && hasMapKey(),
    lat: p.lat,
    lng: p.lng
  }));
  const set = { date, photos };

  // Never freeze an empty set (Immich down / genuinely nothing) — leave it unbuilt
  // so it retries next tick / request and the client keeps falling back to random.
  if (photos.length === 0) return set;

  try {
    await mkdir(DAILY_DIR, { recursive: true });
    await writeFile(setFile(date), JSON.stringify(set));
    void pruneDaily();
  } catch { /* serve even if the freeze write fails */ }

  if (warm) await warmSet(set);
  else void warmSet(set);
  return set;
}

/** Today's frozen set, building on demand when the file is missing. */
export async function getDailySet(now = new Date()) {
  const date = ymd(now);
  try {
    return JSON.parse(await readFile(setFile(date), "utf8"));
  } catch { /* miss → build */ }
  return buildDailySet(now);
}

// Build the set for `date` if it isn't frozen yet (idempotent — a frozen set is
// never rebuilt within its day).
async function ensureBuilt(date, opts) {
  try { await stat(setFile(ymd(date))); return; } catch { /* not frozen → build */ }
  await buildDailySet(date, opts);
}

// ── scheduler ──────────────────────────────────────────────────
let scheduled = false;
export function initDailyMemories() {
  if (scheduled) return;
  scheduled = true;
  const tick = async () => {
    try {
      await ensureBuilt(new Date(), { warm: true });          // today is ready + warm
      if (new Date().getHours() >= EVENING_HOUR) {            // pre-build tomorrow
        const t = new Date();
        t.setDate(t.getDate() + 1);
        await ensureBuilt(t, { warm: true });
      }
    } catch { /* best-effort — retries next hour */ }
  };
  tick();                                                     // on boot
  setInterval(tick, 60 * 60 * 1000);                         // hourly (init-once)
}
