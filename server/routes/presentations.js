import express from "express";
import { readFile, writeFile, appendFile, mkdir, rename } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

/* ═══ THE WALL'S LOG — HOUSE-MIND S6a (docs/design/HOUSE-MIND.md §S6) ════════
   One row per presentation, appended by the page (src/v3/core/presentation-log.js).
   Rows are facts about the MACHINE — what it showed, where, when, on what
   evidence, what the arbiter decided. Never about the people: phase-8's
   "aggregates-not-logs" forbids a per-event log about the residents.

   So this route does not trust the page to have got that right:
     · WHITELIST — a row is rebuilt from the known fields. Anything else the page
       sends (a `present`, a `person`, a `home`) is not written.
     · SCRUB — an id naming a person entity (`arrival:person.x`) is stored as
       its source, the same rule the page applies.
     · A row with no end is refused (400): a presentation is logged once, when
       it closes.

   ON-DEVICE ONLY. data/presentations/ is untracked; nothing here talks to any
   upstream. Retention: 90 days (owner, 2026-09-27), applied on every read and
   at most hourly on write, plus a hard row cap so a runaway page cannot fill
   the disk before the clock does.
   ═══════════════════════════════════════════════════════════════════════════ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "..", "data", "presentations");
const FILE = path.join(DIR, "rows.jsonl");

export const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_ROWS = 200_000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const SURFACES = new Set(["glance", "spread", "stage", "voice"]);
const ACTIONS = new Set(["took", "dropped", "refused", "superseded"]);
const STR_MAX = 160;

function str(v, max = STR_MAX) {
  if (v == null) return null;
  if (typeof v !== "string") return undefined;
  return v.slice(0, max);
}

function scrub(id, source) {
  if (id == null) return null;
  return /person\./i.test(id) ? source : id;
}

/**
 * The row as it may be stored, or a string saying why not. Pure; exported for
 * the spec.
 */
export function cleanRow(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "expected { row: object }";
  if (!SURFACES.has(raw.surface)) return "bad surface";
  const source = str(raw.source, 64);
  const id = str(raw.id);
  const evidenceKey = str(raw.evidenceKey, 64);
  if (source === undefined || id === undefined || evidenceKey === undefined) return "bad string field";
  const { start, end } = raw;
  if (!Number.isFinite(start) || start <= 0) return "bad start";
  if (!Number.isFinite(end)) return "missing end";
  if (end < start) return "end before start";
  if (end > now + 60_000) return "end in the future";

  let decision = null;
  if (raw.decision != null) {
    const action = raw.decision?.action;
    if (!ACTIONS.has(action)) return "bad decision";
    const over = str(raw.decision.over, 64);
    decision = { action, over: over === undefined ? null : over };
  }

  return {
    surface: raw.surface,
    id: scrub(id, source),
    source,
    evidenceKey: evidenceKey != null && /person\./i.test(evidenceKey) ? "ha:person" : evidenceKey,
    decision,
    shown: raw.shown !== false,
    start,
    end
  };
}

/** Rows inside the retention window, newest MAX_ROWS kept. Pure; exported for the spec. */
export function prune(rows, now = Date.now()) {
  const floor = now - RETENTION_MS;
  const kept = rows.filter((r) => Number.isFinite(r?.end) && r.end >= floor);
  return kept.length > MAX_ROWS ? kept.slice(kept.length - MAX_ROWS) : kept;
}

async function readRows() {
  let raw = "";
  try {
    raw = await readFile(FILE, "utf8");
  } catch {
    return []; // cold start — no file yet
  }
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line is dropped, not fatal */ }
  }
  return rows;
}

async function writeRows(rows) {
  await mkdir(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  await rename(tmp, FILE);
}

/* Every file operation runs on one chain, so a prune's rewrite can never
   interleave with an append and lose it. */
let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.then(() => {}, () => {});
  return next;
}

let lastPrune = 0;
async function pruneFile(now) {
  const rows = await readRows();
  const kept = prune(rows, now);
  if (kept.length !== rows.length) await writeRows(kept);
  lastPrune = now;
  return kept;
}

const router = express.Router();

router.post("/api/presentations", async (req, res) => {
  const row = cleanRow(req.body?.row);
  if (typeof row === "string") return res.status(400).json({ error: row });
  try {
    await serial(async () => {
      await mkdir(DIR, { recursive: true });
      await appendFile(FILE, JSON.stringify(row) + "\n", "utf8");
      const now = Date.now();
      if (now - lastPrune > PRUNE_EVERY_MS) await pruneFile(now);
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ?since=<epoch ms> (rows that ended at or after it) &limit=<n> (newest n,
   default 500, max 5000). Oldest first. */
router.get("/api/presentations", async (req, res) => {
  const since = Number(req.query.since);
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 5000) : 500;
  try {
    const rows = await serial(() => pruneFile(Date.now()));
    const hits = Number.isFinite(since) ? rows.filter((r) => r.end >= since) : rows;
    res.json({ rows: hits.slice(Math.max(0, hits.length - limit)), retentionDays: RETENTION_MS / 86_400_000 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
