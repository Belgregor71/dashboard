import express from "express";
import crypto from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchWithTimeout } from "../utils/fetch.js";
import { reportFailure, reportSuccess } from "../services/healthService.js";

const router = express.Router();

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tts-cache");
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// AI briefing text is unique every day, so without pruning the cache grows
// without bound on the Pi's SD card (~1 MB/day observed).
function pruneCache() {
  if (!existsSync(CACHE_DIR)) return;
  const cutoff = Date.now() - CACHE_MAX_AGE_MS;
  try {
    for (const file of readdirSync(CACHE_DIR)) {
      if (!file.endsWith(".wav")) continue;
      const filePath = path.join(CACHE_DIR, file);
      if (statSync(filePath).mtimeMs < cutoff) unlinkSync(filePath);
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
  return { buffer, cached: false };
}

router.post("/api/tts/speak", async (req, res) => {
  const { text, rate } = req.body ?? {};
  if (!text) { res.status(400).json({ error: "text is required" }); return; }

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
