import express from "express";
import { readFile, writeFile, appendFile, mkdir, rename } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { loopbackOnly } from "../middleware/security.js";
import { readFeatureCensus } from "./censusFeatures.js";

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

// The wall is the only writer (src/v3/core/presentation-log.js), and it is loopback.
router.post("/api/presentations", loopbackOnly("The wall's log"), async (req, res) => {
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
    console.error("[presentations] append failed:", error);
    res.status(500).json({ error: "Could not store the row" });
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
    console.error("[presentations] read failed:", error);
    res.status(500).json({ error: "Could not read the log" });
  }
});

/* ═══ THE DIGEST — HOUSE-MIND S6c ═════════════════════════════════════════════
   What the wall showed over the last N days, per source, for the OWNER to read.
   Two inputs, never joined row to row:
     · the rows above   → shown, seconds on the glass, spoken, not shown
     · the census's ppl:* counters (S6b) → present, cut, followed
   Read-only. Nothing here feeds ranking or wording (S6 points 3 and 5).
   ═══════════════════════════════════════════════════════════════════════════ */

export const DIGEST_DEFAULT_DAYS = 7;
export const DIGEST_MAX_DAYS = 30; // the census keeps 30 days; a longer digest would be rows without counters

function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function duration(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const times = (n) => `${n}×`;

/**
 * Pure; exported for the spec. `today` is a local day string and the window is
 * the `days` local days ending on it — the census's own day keys, so the rows
 * and the counters are cut at the same midnight.
 */
export function buildDigest(rows, census, { today, days = DIGEST_DEFAULT_DAYS } = {}) {
  const window = new Set();
  const [y, m, d] = today.split("-").map(Number);
  for (let i = 0; i < days; i++) window.add(localDay(new Date(y, m - 1, d - i).getTime()));

  const bySource = new Map();
  const at = (source) => {
    const key = source || "(none)";
    if (!bySource.has(key)) {
      bySource.set(key, { source: key, shown: 0, seconds: 0, spoken: 0, spokenSeconds: 0, notShown: 0, present: 0, cut: 0, followed: 0 });
    }
    return bySource.get(key);
  };

  let counted = 0;
  for (const r of rows ?? []) {
    if (!Number.isFinite(r?.start) || !Number.isFinite(r?.end) || !window.has(localDay(r.start))) continue;
    counted += 1;
    const s = at(r.source);
    const secs = Math.max(0, r.end - r.start) / 1000;
    if (r.shown === false) s.notShown += 1;
    else if (r.surface === "voice") { s.spoken += 1; s.spokenSeconds += secs; }
    else { s.shown += 1; s.seconds += secs; }
  }

  for (const [day, counts] of Object.entries(census?.days ?? {})) {
    if (!window.has(day)) continue;
    for (const [key, n] of Object.entries(counts ?? {})) {
      const [ns, source, outcome] = key.split(":");
      if (ns !== "ppl" || !["present", "cut", "followed"].includes(outcome)) continue;
      at(source)[outcome] += n;
    }
  }

  const sources = [...bySource.values()]
    .map((s) => ({ ...s, seconds: Math.round(s.seconds), spokenSeconds: Math.round(s.spokenSeconds) }))
    .sort((a, b) => b.seconds - a.seconds || b.shown - a.shown || a.source.localeCompare(b.source));

  const lines = sources.map((s) => {
    const parts = [];
    if (s.shown) parts.push(`shown ${times(s.shown)}, ${duration(s.seconds)} on the glass`);
    if (s.spoken) parts.push(`spoken ${times(s.spoken)}`);
    if (s.notShown) parts.push(`refused or dropped ${times(s.notShown)}`);
    if (s.present) parts.push(`someone present ${times(s.present)}`);
    if (s.followed) parts.push(`followed by a question ${times(s.followed)}`);
    if (s.cut) parts.push(`cut off ${times(s.cut)}`);
    return `${s.source}: ${parts.join("; ")}`;
  });

  const sorted = [...window].sort();
  return { days, from: sorted[0], to: sorted[sorted.length - 1], rows: counted, sources, lines };
}

// ?days=<1..30>, default 7. Anyone on the LAN may read it; nothing writes.
router.get("/api/presentations/digest", async (req, res) => {
  const raw = Number(req.query.days);
  const days = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), DIGEST_MAX_DAYS) : DIGEST_DEFAULT_DAYS;
  try {
    const now = Date.now();
    const [rows, census] = await Promise.all([serial(() => pruneFile(now)), readFeatureCensus()]);
    res.json(buildDigest(rows, census, { today: localDay(now), days }));
  } catch (error) {
    console.error("[presentations] digest failed:", error);
    res.status(500).json({ error: "Could not build the digest" });
  }
});

export default router;
