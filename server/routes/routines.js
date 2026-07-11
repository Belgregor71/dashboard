import express from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Behavioural-learning persistence — Phase 8 (docs/vision/phase-8-learn.md).
// A small GET/PUT of the aggregate blob to data/routines/, mirroring the
// holiday-cache precedent (calendar.js): a single bounded file, aggregates
// only, never a per-event log.
//
// ON-DEVICE ONLY — this route never talks to any upstream. Behavioural data
// stays on the Pi (the same privacy guardrail as voice transcripts). Cold start
// (no file yet) degrades to an empty object, never an error.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROUTINES_DIR = path.join(__dirname, "..", "..", "data", "routines");
const ROUTINES_FILE = path.join(ROUTINES_DIR, "aggregates.json");

const router = express.Router();

router.get("/api/routines", async (_req, res) => {
  try {
    const raw = await readFile(ROUTINES_FILE, "utf8");
    res.json({ routines: JSON.parse(raw) });
  } catch {
    res.json({ routines: {} }); // cold start — no file yet
  }
});

router.put("/api/routines", async (req, res) => {
  const routines = req.body?.routines;
  if (!routines || typeof routines !== "object" || Array.isArray(routines)) {
    return res.status(400).json({ error: "expected { routines: object }" });
  }
  try {
    await mkdir(ROUTINES_DIR, { recursive: true });
    await writeFile(ROUTINES_FILE, JSON.stringify(routines), "utf8");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
