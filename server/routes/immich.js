import express from "express";
import { readFile, writeFile, mkdir, readdir, stat, unlink } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { isConfigured, searchRandom, onThisDay, searchTaken, fetchRendition } from "../services/immichClient.js";
import { getDailySet, getMapTile, hasMapKey, initDailyMemories } from "../services/dailyMemories.js";
import { clipPathFor, hasClip, hasSkip } from "../services/liveMotion.js";
import { hiddenIds, hide, undo } from "../services/photoVeto.js";
import { labelPeople, warmRoster } from "../services/photoNames.js";

// Dashboard-facing Immich proxy — Phase 9.5 (docs/vision/photo-source-immich.md).
// The browser only ever talks to these three endpoints; the API key stays in the
// server (immichClient). Renditions are cached to disk (bounded prune — the 24/7
// kiosk failure mode is unbounded growth), metadata in memory with a short TTL.
// Everything degrades to empty/404 when Immich is unconfigured or unreachable, so
// a sleeping Synology is invisible on the glass.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, "..", "..", "data", "immich-cache");
const CACHE_MAX_FILES = 500;             // ~50 KB each → ~25 MB ceiling
const ON_THIS_DAY_TTL_MS = 60 * 60 * 1000;   // recompute at most hourly (day-stable anyway)
const RANDOM_TTL_MS = 10 * 60 * 1000;
const BROWSE_TTL_MS = 10 * 60 * 1000;        // a taken-date window is stable for a while
const UUID_RE = /^[a-f0-9-]{36}$/i;

const router = express.Router();

// ── tiny in-memory TTL cache for the metadata calls ────────────
const mem = new Map(); // key → { at, value }
function memGet(key, ttl) {
  const e = mem.get(key);
  return e && Date.now() - e.at < ttl ? e.value : null;
}
function memSet(key, value) {
  mem.set(key, { at: Date.now(), value });
  return value;
}

// ── bounded disk cache for downscaled renditions ───────────────
// Counts FILES, sized for ~47 KB jpegs. The `daily/` and `clips/` subdirectories
// each count as one entry and their unlink fails harmlessly — leave that alone.
// Clips are bounded separately, by bytes, in services/liveMotion.js: mixing
// ~300 KB mp4s into a count-based ceiling would make it mean anything between
// 25 MB and 150 MB, and would let a cold clip evict a warm still.
async function pruneCache() {
  try {
    const files = await readdir(CACHE_DIR);
    if (files.length <= CACHE_MAX_FILES) return;
    const withTimes = await Promise.all(
      files.map(async (f) => ({ f, t: (await stat(path.join(CACHE_DIR, f))).mtimeMs }))
    );
    withTimes.sort((a, b) => a.t - b.t); // oldest first
    const toDrop = withTimes.slice(0, withTimes.length - CACHE_MAX_FILES);
    await Promise.all(toDrop.map(({ f }) => unlink(path.join(CACHE_DIR, f)).catch(() => {})));
  } catch { /* best-effort */ }
}

/* ⚠ labelPeople() is applied OUTSIDE the memo, on the way out, and the memo
   holds the raw upstream assets. Naming is cheap (a map over ≤100 assets) and
   the vault reindexes every ten minutes — labelling before the cache would pin
   a caption to whatever the vault said up to an hour ago, so an edited
   relationship note would look like it had not synced. labelPeople never
   mutates its input, which is what makes this safe against a shared cache. */
router.get("/api/immich/on-this-day", async (_req, res) => {
  if (!isConfigured()) return res.json({ assets: [] });
  warmRoster(); // background, never awaited — see photoNames.js
  const key = `otd:${new Date().toDateString()}`;
  const cached = memGet(key, ON_THIS_DAY_TTL_MS);
  if (cached) return res.json({ assets: labelPeople(cached) });
  const assets = await onThisDay(new Date());
  res.json({ assets: labelPeople(memSet(key, assets)) });
});

/* ── The veto ───────────────────────────────────────────────────────────────
   "Not this one", said to the room, is the only quality signal this library
   has (server/services/photoVeto.js explains why nothing else works).

   ⚠ EVERY WRITE CLEARS THE METADATA CACHE, and it must. on-this-day is memoised
   for an hour and the random feed for ten minutes, so without this the
   photograph the room just rejected keeps being served from memory — the veto
   would look broken for exactly as long as it takes to give up on it.

   ⚠ Clears the WHOLE memo rather than the three key prefixes it knows about.
   A prefix list is a second place to remember, and it was wrong within minutes
   of being written (`browse:`, not `brw:`). This map holds nothing but search
   metadata, all of it re-fetchable, so the cost of over-clearing is one extra
   Immich round trip and the cost of under-clearing is a feature that looks
   broken. */
function forgetCachedSearches() {
  mem.clear();
}

router.get("/api/immich/hidden", (_req, res) => {
  res.json({ ids: hiddenIds() });
});

router.post("/api/immich/hidden", express.json(), (req, res) => {
  const raw = req.body?.ids ?? req.body?.id;
  const ids = (Array.isArray(raw) ? raw : [raw]).filter((id) => UUID_RE.test(String(id ?? "")));
  // A veto with nothing to veto is the caller's mistake, not a server error —
  // and saying so plainly is what stops a silent no-op reading as success.
  if (!ids.length) return res.status(400).json({ error: "no valid asset id" });

  const result = hide(ids);
  forgetCachedSearches();
  res.json(result);
});

/* The safety rail. A veto is SPOKEN, and speech misfires — the television, a
   guest, half a sentence. Without a way back one mishearing removes a
   photograph permanently and the room never learns which one it lost. */
router.post("/api/immich/hidden/undo", express.json(), (_req, res) => {
  const result = undo();
  forgetCachedSearches();
  res.json(result);
});

router.get("/api/immich/random", async (req, res) => {
  if (!isConfigured()) return res.json({ assets: [] });
  warmRoster();
  const count = Math.min(Math.max(parseInt(req.query.count, 10) || 12, 1), 60);
  const key = `rnd:${count}`;
  const cached = memGet(key, RANDOM_TTL_MS);
  if (cached) return res.json({ assets: labelPeople(cached) });
  const assets = await searchRandom(count);
  res.json({ assets: labelPeople(memSet(key, assets)) });
});

// Browse assets by taken-date window — the authoring portal's month view. Params
// are validated BEFORE the config check so the 400 contract holds on any machine,
// Immich or not. Degrades to { assets: [] } when Immich is absent/unreachable.
router.get("/api/immich/browse", async (req, res) => {
  const after = String(req.query.after || "");
  const before = String(req.query.before || "");
  const valid = (s) => !Number.isNaN(Date.parse(s));
  if (!valid(after) || !valid(before)) {
    return res.status(400).json({ error: "after & before are required ISO timestamps" });
  }
  if (!isConfigured()) return res.json({ assets: [] });

  const key = `browse:${after}:${before}`;
  const cached = memGet(key, BROWSE_TTL_MS);
  if (cached) return res.json({ assets: cached });
  const assets = await searchTaken(after, before, 250);
  res.json({ assets: memSet(key, assets) });
});

// The frozen Daily Memories set for today (features.dailyMemories). Builds on
// demand when the evening prefetch hasn't run yet; { date, photos: [] } when
// Immich is unconfigured/unreachable so the client falls back to the random draw.
router.get("/api/immich/daily-set", async (_req, res) => {
  // Self-gating: the evening prefetch scheduler only starts once the client (with
  // the flag on) actually asks for the set — flag-off means this is never hit and
  // no extra NAS load ever happens. Idempotent, so repeated calls are free.
  initDailyMemories();
  const set = await getDailySet(new Date());
  res.json({ ...set, photos: await Promise.all((set.photos || []).map(publicPhoto)) });
});

/**
 * The browser's view of a frozen photo.
 *
 * `motionId` is INTERNAL — it exists on disk so the overnight transcoder knows
 * what to fetch, and it is dropped here. What ships instead is `motion`, a
 * boolean meaning "a playable clip is on local disk RIGHT NOW", read by stat
 * rather than by trusting Immich. That distinction is the whole point: every
 * way this can fail — NAS asleep, HEVC source, ffmpeg missing, encode failed,
 * clip pruned — collapses into `false`, so the client cannot request a clip
 * that isn't there and a 404 burst is structurally impossible.
 *
 * `motionPending` is the other half of that boolean, and it exists because
 * collapsing every failure into `false` also collapses the one case that is not
 * a failure: the clip is coming. The first request of a new day BUILDS that
 * day's set, and the transcode is fired without being awaited — so the very
 * response that seeds the client's pool is the one moment `motion` is
 * guaranteed false for every clip of that day. Measured on the box on
 * 2026-08-03: set frozen 00:00:59, clips on disk 00:01:00–00:01:13, and the
 * kiosk — whose pool is deliberately day-stable — carried `motion: false` for
 * the next sixteen hours and never played a single Live Photo.
 *
 * So: true means "asking again later could change the answer". A photo with no
 * motion part upstream is not pending, and neither is one already tombstoned
 * .none — both are settled, and the client can stop asking.
 */
async function publicPhoto(p) {
  const { motionId, ...rest } = p || {};
  const motion = await hasClip(rest.id);
  return {
    ...rest,
    motion,
    motionPending: Boolean(motionId) && !motion && !(await hasSkip(rest.id))
  };
}

// A proxied + disk-cached static map tile for a travel photo's coordinates. The
// map API key stays server-side; the browser only ever hits this endpoint.
router.get("/api/immich/map", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "lat & lng are required numbers" });
  }
  if (!hasMapKey()) return res.status(404).json({ error: "map not configured" });

  const tile = await getMapTile(lat, lng);
  if (!tile) return res.status(502).json({ error: "map unreachable" });
  res.set("Content-Type", tile.contentType);
  res.set("Cache-Control", "public, max-age=604800");
  res.send(tile.buffer);
});

router.get("/api/immich/asset/:id/thumb", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "bad asset id" });
  if (!isConfigured()) return res.status(404).json({ error: "immich not configured" });

  const cacheFile = path.join(CACHE_DIR, `${id}.jpg`);
  try {
    const buf = await readFile(cacheFile);
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(buf);
  } catch { /* cache miss → fetch below */ }

  const rendition = await fetchRendition(id, "preview");
  if (!rendition) return res.status(502).json({ error: "immich unreachable" });

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile, rendition.buffer);
    void pruneCache();
  } catch { /* serve even if the cache write fails */ }

  res.set("Content-Type", rendition.contentType);
  res.set("Cache-Control", "public, max-age=86400");
  res.send(rendition.buffer);
});

/**
 * A Live Photo's motion part, already normalised to faststart H.264 on local
 * disk by the overnight transcoder (services/liveMotion.js). `:id` is the STILL
 * asset's id, mirroring /thumb.
 *
 * ⚠ This route NEVER reaches Immich. That is why its status set is {400,404,200}
 * with no 502, where /thumb above has one: /thumb may fetch on a miss, this may
 * not. Keeping the NAS off the render path is the entire design — a lazy fetch
 * here would wake a sleeping Synology audibly, mid-rotation, to serve a 3s clip.
 * Missing file is simply 404, and the client renders the still it already has.
 *
 * sendFile, not a hand-rolled stream: Accept-Ranges, 206, Content-Range and 416
 * all come free, and hand-rolled range handling is where the bug would live.
 */
router.get("/api/immich/asset/:id/clip", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "bad asset id" });
  if (!(await hasClip(id))) return res.status(404).json({ error: "no clip" });

  res.sendFile(clipPathFor(id), {
    headers: { "Content-Type": "video/mp4", "Cache-Control": "public, max-age=86400" }
  }, (err) => {
    // Raced a prune, or the file vanished between stat and send. Only answer if
    // nothing has gone out yet — otherwise the response is already committed.
    if (err && !res.headersSent) res.status(404).json({ error: "no clip" });
  });
});

export default router;
