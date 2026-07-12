import express from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Delight-budget persistence — Phase 10 (docs/vision/phase-10-temperament.md).
// A small GET/PUT of the rare-moment budgets to data/delight/, mirroring the
// Phase 8 routines precedent (routines.js): a single bounded file that records
// which delight moments have already fired, so a moment can't repeat after a
// reboot — the "once a year, not a feature" guarantee survives power loss.
//
// ON-DEVICE ONLY — never talks to any upstream. Cold start (no file yet) degrades
// to an empty object, never an error.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DELIGHT_DIR = path.join(__dirname, "..", "..", "data", "delight");
const DELIGHT_FILE = path.join(DELIGHT_DIR, "budgets.json");

const router = express.Router();

router.get("/api/delight", async (_req, res) => {
  try {
    const raw = await readFile(DELIGHT_FILE, "utf8");
    res.json({ budgets: JSON.parse(raw) });
  } catch {
    res.json({ budgets: {} }); // cold start — no file yet
  }
});

router.put("/api/delight", async (req, res) => {
  const budgets = req.body?.budgets;
  if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) {
    return res.status(400).json({ error: "expected { budgets: object }" });
  }
  try {
    await mkdir(DELIGHT_DIR, { recursive: true });
    await writeFile(DELIGHT_FILE, JSON.stringify(budgets), "utf8");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
