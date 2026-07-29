import express from "express";
import crypto from "crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { fetchWithTimeout } from "../utils/fetch.js";
import { loopbackOnly } from "../middleware/security.js";
import { reportFailure, reportSuccess } from "../services/healthService.js";

const router = express.Router();

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tts-cache");
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Half-written entries are named <hash>.wav.<pid>-<n>.tmp so the ".wav" filter
// below never counts or serves one. An orphan only survives a hard kill
// mid-write; sweep any older than this so it cannot sit outside the byte
// ceiling forever.
const TMP_SUFFIX = ".tmp";
const TMP_MAX_AGE_MS = 60 * 60 * 1000;
// Every legitimate line — alerts, briefings, concierge replies — is far under
// this; it exists so one request cannot commission an audiobook.
const MAX_TEXT_LENGTH = 400;

// Age alone does not bound the cache: a burst of unique text fills the SD card
// long before anything is 14 days old (audit 2026-07-26, S1). Steady state is
// ~1 MB/day against a 14-day window, so 100 MB is ~5x headroom over normal use.
//
// Read per-call, not at module load: server.js imports this route before it
// calls dotenv.config(), so a module-level capture froze the default and made
// the documented TTS_CACHE_MAX_BYTES silently unsettable — the same trap the
// KOKORO_VOICE comment below describes.
function cacheMaxBytes() {
  return Number(process.env.TTS_CACHE_MAX_BYTES ?? 100 * 1024 * 1024);
}

// Walked serially rather than with Promise.all: nothing waits on this sweep
// except a synthesis that already costs ~1 s, and firing ~400 stats at once
// would queue them all through libuv's 4-thread pool ahead of the photo and
// WAV reads the kiosk is doing at the same time.
async function cacheEntries() {
  let files;
  try {
    files = await readdir(CACHE_DIR);
  } catch (err) {
    if (err.code === "ENOENT") return { wavs: [], orphans: [] };
    throw err;
  }

  const now = Date.now();
  const wavs = [];
  const orphans = [];
  for (const file of files) {
    const isWav = file.endsWith(".wav");
    if (!isWav && !file.endsWith(TMP_SUFFIX)) continue;
    const filePath = path.join(CACHE_DIR, file);
    let info;
    try {
      info = await stat(filePath);
    } catch (err) {
      // Vanished mid-sweep (a manual rm, or a rename completing under us) —
      // nothing to weigh and nothing to delete.
      if (err.code === "ENOENT") continue;
      throw err;
    }
    if (isWav) wavs.push({ filePath, mtimeMs: info.mtimeMs, size: info.size });
    else if (now - info.mtimeMs > TMP_MAX_AGE_MS) orphans.push(filePath);
  }
  return { wavs, orphans };
}

async function removeQuietly(filePath) {
  try {
    await unlink(filePath);
  } catch (err) {
    // Already gone — the goal is met either way, and throwing here would abort
    // the rest of the sweep.
    if (err.code !== "ENOENT") throw err;
  }
}

// AI briefing text is unique every day, so without pruning the cache grows
// without bound on the Pi's SD card (~1 MB/day observed). Two ceilings: age,
// then total bytes with oldest-first (LRU) eviction.
async function runPrune() {
  try {
    const { wavs, orphans } = await cacheEntries();
    for (const filePath of orphans) await removeQuietly(filePath);

    const cutoff = Date.now() - CACHE_MAX_AGE_MS;
    const kept = [];
    for (const entry of wavs) {
      if (entry.mtimeMs < cutoff) await removeQuietly(entry.filePath);
      else kept.push(entry);
    }

    let total = kept.reduce((sum, entry) => sum + entry.size, 0);
    const ceiling = cacheMaxBytes();
    if (total <= ceiling) return;
    kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of kept) {
      if (total <= ceiling) break;
      await removeQuietly(entry.filePath);
      total -= entry.size;
    }
  } catch (err) {
    console.warn("[TTS] cache prune failed:", err.message);
  }
}

let prunePromise = null;

// Coalesced to one sweep at a time. Sync prunes could not overlap; async ones
// can — boot, the 24 h timer and every cache miss all call this — and two
// sweeps racing would unlink each other's entries, so the loser's `kept` list
// would be stale by the time it evicted from it. A caller arriving mid-sweep
// joins the one in flight; the next write prunes again anyway.
//
// `.then(clear, clear)` rather than `.finally(clear)`: finally re-throws on a
// fresh chain, and this promise is deliberately fire-and-forget at module load.
function pruneCache() {
  if (!prunePromise) {
    const clear = () => { prunePromise = null; };
    prunePromise = runPrune().then(clear, clear);
  }
  return prunePromise;
}

// Safe to leave floating: runPrune swallows and logs its own failures, so the
// promise pruneCache hands back never rejects.
pruneCache();
setInterval(pruneCache, PRUNE_INTERVAL_MS).unref();

function cachePathFor(text, speed) {
  const key = crypto.createHash("sha256").update(`${text}::${speed}`).digest("hex");
  return path.join(CACHE_DIR, `${key}.wav`);
}

// One readFile instead of existsSync + readFileSync: one fewer syscall, no gap
// between the check and the read, and an entry that exists but cannot be read
// now degrades to a re-synthesis instead of 502ing that line every time until
// someone deletes it by hand.
async function readCached(cachePath) {
  try {
    return await readFile(cachePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`[TTS] unreadable cache entry ${path.basename(cachePath)}: ${err.message} — re-synthesizing`);
    }
    return null;
  }
}

let tmpCounter = 0;

// Write to a temp file and rename into place. The old sync write was safe by
// accident — writeFileSync cannot interleave — but two concurrent async writes
// of the same text would shred each other's bytes, and a reader could observe a
// half-written WAV. rename() within one directory is atomic, so an entry is
// either absent or complete.
async function writeAtomic(cachePath, buffer) {
  const tmpPath = `${cachePath}.${process.pid}-${tmpCounter++}${TMP_SUFFIX}`;
  try {
    await writeFile(tmpPath, buffer);
    await rename(tmpPath, cachePath);
  } catch (err) {
    await removeQuietly(tmpPath);
    // The destination is a hash of the text and speed, so a writer that beat us
    // to it stored audio for the same line: losing the race is success. Windows
    // is what surfaces this — it cannot replace a file another handle has open,
    // so a concurrent rename fails EPERM where POSIX (the Pi) just wins
    // silently. Either way, an entry already sitting there is the entry we
    // wanted, and the caller still gets the buffer we synthesized.
    if (await isCompleteEntry(cachePath)) return;
    throw err;
  }
}

async function isCompleteEntry(cachePath) {
  try {
    return (await stat(cachePath)).size > 0;
  } catch {
    return false;
  }
}

async function synthViaKokoro(url, text, speed, timeoutMs) {
  // Read per-call, not at module load: server.js imports this route before it
  // calls dotenv.config(), so a module-level capture would freeze the default
  // (KOKORO_URL below is read per-call for the same reason).
  const voice = process.env.KOKORO_VOICE ?? "bf_emma";
  const upstream = await fetchWithTimeout(`${url}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "kokoro",
      input: text,
      voice,
      response_format: "wav",
      speed
    })
  }, timeoutMs);

  if (!upstream.ok) throw new Error(`Kokoro HTTP ${upstream.status}`);
  return Buffer.from(await upstream.arrayBuffer());
}

// Return a WAV buffer for text/speed — from the disk cache if present, else
// synthesized via Kokoro and cached. Throws if Kokoro is unreachable/errors.
// Shared by the /speak route and the boot-time cache warmer (ttsWarmer.js).
//
// Primary = the fast PC Kokoro (project-voice-mic-bridge, ~1s vs the NAS's
// ~18s for dynamic text); optional KOKORO_FALLBACK_URL = the always-on NAS
// Kokoro for when the PC is off. When a fallback is configured the primary gets
// a short timeout so failover is quick — a sleeping PC must not stall every
// reply; with no fallback set, behaviour is exactly as before (single upstream).
export async function getOrSynthesizeTts(text, speed) {
  const cachePath = cachePathFor(text, speed);
  const hit = await readCached(cachePath);
  if (hit) return { buffer: hit, cached: true };

  const primary = process.env.KOKORO_URL ?? "http://localhost:8880";
  const fallback = process.env.KOKORO_FALLBACK_URL;

  let buffer;
  try {
    buffer = await synthViaKokoro(primary, text, speed, fallback ? 6_000 : 30_000);
  } catch (err) {
    if (!fallback) throw err;
    console.warn(`[TTS] primary Kokoro (${primary}) failed: ${err.message} — using fallback`);
    buffer = await synthViaKokoro(fallback, text, speed, 30_000);
  }

  await mkdir(CACHE_DIR, { recursive: true });
  await writeAtomic(cachePath, buffer);
  // Enforce the ceiling on write, not only on the 24 h timer — a burst of
  // unique text is exactly the case the daily prune cannot catch in time.
  // Awaited, not floated: the sweep no longer blocks the event loop, so its
  // wall clock is invisible next to Kokoro's ~1 s, and keeping it ordered means
  // "synthesized" implies "cache is within its ceiling".
  await pruneCache();
  return { buffer, cached: false };
}

router.post("/api/tts/speak", loopbackOnly("TTS"), async (req, res) => {
  const { text, rate } = req.body ?? {};
  if (!text) { res.status(400).json({ error: "text is required" }); return; }
  if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: `text must be a string of at most ${MAX_TEXT_LENGTH} characters` });
    return;
  }

  const speed = Number.isFinite(rate) && rate > 0 ? rate : 1.0;

  try {
    const { buffer, cached } = await getOrSynthesizeTts(text, speed);
    if (!cached) reportSuccess("tts");
    res.set("Content-Type", "audio/wav");
    res.set("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err) {
    console.error("[TTS] Kokoro error:", err.message);
    reportFailure("tts", err.message);
    res.status(502).json({ error: "TTS unavailable" });
  }
});

export default router;
