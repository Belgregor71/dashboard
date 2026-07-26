import express from "express";
import crypto from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchWithTimeout } from "../utils/fetch.js";
import { loopbackOnly } from "../middleware/security.js";
import { reportFailure, reportSuccess } from "../services/healthService.js";

const router = express.Router();

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tts-cache");
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Age alone does not bound the cache: a burst of unique text fills the SD card
// long before anything is 14 days old (audit 2026-07-26, S1). Steady state is
// ~1 MB/day against a 14-day window, so 100 MB is ~5x headroom over normal use.
const CACHE_MAX_BYTES = Number(process.env.TTS_CACHE_MAX_BYTES ?? 100 * 1024 * 1024);
// Every legitimate line — alerts, briefings, concierge replies — is far under
// this; it exists so one request cannot commission an audiobook.
const MAX_TEXT_LENGTH = 400;

function cacheEntries() {
  return readdirSync(CACHE_DIR)
    .filter((file) => file.endsWith(".wav"))
    .map((file) => {
      const filePath = path.join(CACHE_DIR, file);
      const stat = statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs, size: stat.size };
    });
}

// AI briefing text is unique every day, so without pruning the cache grows
// without bound on the Pi's SD card (~1 MB/day observed). Two ceilings: age,
// then total bytes with oldest-first (LRU) eviction.
function pruneCache() {
  if (!existsSync(CACHE_DIR)) return;
  const cutoff = Date.now() - CACHE_MAX_AGE_MS;
  try {
    const kept = [];
    for (const entry of cacheEntries()) {
      if (entry.mtimeMs < cutoff) unlinkSync(entry.filePath);
      else kept.push(entry);
    }

    let total = kept.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= CACHE_MAX_BYTES) return;
    kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of kept) {
      if (total <= CACHE_MAX_BYTES) break;
      unlinkSync(entry.filePath);
      total -= entry.size;
    }
  } catch (err) {
    console.warn("[TTS] cache prune failed:", err.message);
  }
}

pruneCache();
setInterval(pruneCache, PRUNE_INTERVAL_MS).unref();

function cachePathFor(text, speed) {
  const key = crypto.createHash("sha256").update(`${text}::${speed}`).digest("hex");
  return path.join(CACHE_DIR, `${key}.wav`);
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
  if (existsSync(cachePath)) {
    return { buffer: readFileSync(cachePath), cached: true };
  }

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

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, buffer);
  // Enforce the ceiling on write, not only on the 24 h timer — a burst of
  // unique text is exactly the case the daily prune cannot catch in time.
  pruneCache();
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
