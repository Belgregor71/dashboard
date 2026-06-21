import express from "express";
import { fetchWithTimeout } from "../utils/fetch.js";

const router = express.Router();

router.post("/api/tts/speak", async (req, res) => {
  const kokoroUrl = process.env.KOKORO_URL ?? "http://localhost:8880";
  const voice = process.env.KOKORO_VOICE ?? "bf_emma";
  const { text, rate } = req.body ?? {};
  if (!text) { res.status(400).json({ error: "text is required" }); return; }

  try {
    const upstream = await fetchWithTimeout(`${kokoroUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: text,
        voice,
        response_format: "wav",
        speed: Number.isFinite(rate) && rate > 0 ? rate : 1.0
      })
    }, 30_000);

    if (!upstream.ok) throw new Error(`Kokoro HTTP ${upstream.status}`);
    res.set("Content-Type", "audio/wav");
    res.set("Cache-Control", "no-store");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("[TTS] Kokoro error:", err.message);
    res.status(502).json({ error: "TTS unavailable" });
  }
});

export default router;
