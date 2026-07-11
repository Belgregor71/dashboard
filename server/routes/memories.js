import express from "express";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Authored-memory loader — Phase 9 (docs/vision/phase-9-remember.md). A read-only
// GET of the structured memory entries the household authors into
// data/memories/*.json (people, pets, places, first-times). There is deliberately
// no PUT: memories are AUTHORED, not inferred — the house holds what the household
// tells it, it does not scrape or invent what matters.
//
// ON-DEVICE ONLY — this route never talks to any upstream, and data/memories/ is
// gitignored: memory content (which touches grief and nostalgia) stays on the Pi,
// the same privacy guardrail as behavioural routines and voice transcripts. Cold
// start (no directory yet) degrades to an empty list, never an error; one bad
// file is skipped, it never takes the rest down.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEMORIES_DIR = path.join(__dirname, "..", "..", "data", "memories");

const router = express.Router();

router.get("/api/memories", async (_req, res) => {
  let files = [];
  try {
    files = (await readdir(MEMORIES_DIR)).filter((f) => f.toLowerCase().endsWith(".json"));
  } catch {
    return res.json({ memories: [] }); // no directory yet — cold start
  }

  const memories = [];
  for (const file of files) {
    try {
      const raw = await readFile(path.join(MEMORIES_DIR, file), "utf8");
      const parsed = JSON.parse(raw);
      // A file may hold one entry or an array of them.
      for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
        if (entry && typeof entry === "object" && entry.id) memories.push(entry);
      }
    } catch {
      /* one malformed file must never break the whole memory set */
    }
  }
  res.json({ memories });
});

export default router;
