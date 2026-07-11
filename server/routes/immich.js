import express from "express";
import { readFile, writeFile, mkdir, readdir, stat, unlink } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { isConfigured, searchRandom, onThisDay, fetchRendition } from "../services/immichClient.js";

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

router.get("/api/immich/on-this-day", async (_req, res) => {
  if (!isConfigured()) return res.json({ assets: [] });
  const key = `otd:${new Date().toDateString()}`;
  const cached = memGet(key, ON_THIS_DAY_TTL_MS);
  if (cached) return res.json({ assets: cached });
  const assets = await onThisDay(new Date());
  res.json({ assets: memSet(key, assets) });
});

router.get("/api/immich/random", async (req, res) => {
  if (!isConfigured()) return res.json({ assets: [] });
  const count = Math.min(Math.max(parseInt(req.query.count, 10) || 12, 1), 60);
  const key = `rnd:${count}`;
  const cached = memGet(key, RANDOM_TTL_MS);
  if (cached) return res.json({ assets: cached });
  const assets = await searchRandom(count);
  res.json({ assets: memSet(key, assets) });
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

export default router;
