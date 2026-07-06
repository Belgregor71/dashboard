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

router.post("/api/tts/speak", async (req, res) => {
  const kokoroUrl = process.env.KOKORO_URL ?? "http://localhost:8880";
  const voice = process.env.KOKORO_VOICE ?? "bf_emma";
  const { text, rate } = req.body ?? {};
  if (!text) { res.status(400).json({ error: "text is required" }); return; }

  const speed = Number.isFinite(rate) && rate > 0 ? rate : 1.0;
  const cachePath = cachePathFor(text, speed);

  if (existsSync(cachePath)) {
    res.set("Content-Type", "audio/wav");
    res.set("Cache-Control", "no-store");
    res.send(readFileSync(cachePath));
    return;
  }

  try {
    const upstream = await fetchWithTimeout(`${kokoroUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: text,
        voice,
        response_format: "wav",
        speed
      })
    }, 30_000);

    if (!upstream.ok) throw new Error(`Kokoro HTTP ${upstream.status}`);
    reportSuccess("tts");
    const buffer = Buffer.from(await upstream.arrayBuffer());

    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, buffer);

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
