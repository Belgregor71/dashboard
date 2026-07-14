import express from "express";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Authored-memory store — Phase 9 (docs/vision/phase-9-remember.md). A read of the
// structured memory entries the household authors into data/memories/*.json
// (people, pets, places, first-times), plus a guarded WRITE the Memory Studio
// portal (static/memories/) uses so entries can be authored by picking a photo
// instead of hand-editing JSON. This is still AUTHORED, not inferred — a person
// chooses every entry; the house never scrapes or invents what matters.
//
// GET merges every *.json in the directory. WRITES are confined to a single file,
// authored.json, so a hand-edited seed.json is never touched by the portal. The
// whole tree is ON-DEVICE ONLY and gitignored: memory content (grief, nostalgia)
// stays on the Pi, the same guardrail as routines and voice transcripts.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEMORIES_DIR = path.join(__dirname, "..", "..", "data", "memories");
const AUTHORED_FILE = path.join(MEMORIES_DIR, "authored.json");

const UUID_RE = /^[a-f0-9-]{36}$/i;
const KINDS = ["trip", "first", "pet", "milestone", "everyday", "photo"];
const MAX_TAGS = 12;

const router = express.Router();

// ── read ───────────────────────────────────────────────────────

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

// ── write (portal only; confined to authored.json) ─────────────

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// Normalise one photo ref to the shape the renderer resolves: an Immich asset is
// { immich: uuid }; an authored file path is a plain non-empty string.
function cleanPhoto(p) {
  if (p && typeof p === "object" && UUID_RE.test(String(p.immich || ""))) {
    return { immich: String(p.immich) };
  }
  if (typeof p === "string" && p.trim()) return p.trim();
  return null;
}

// Turn a portal payload into a valid entry, or null with a reason. Kept strict:
// the entry is written to disk and read back into the attention engine, so a bad
// shape must be rejected here, not discovered on the glass.
function sanitizeEntry(body) {
  if (!body || typeof body !== "object") return { error: "body must be an object" };

  const title = String(body.title || "").trim();
  if (!title || title.length > 120) return { error: "title is required (1–120 chars)" };

  const photos = (Array.isArray(body.photos) ? body.photos : []).map(cleanPhoto).filter(Boolean);
  if (photos.length === 0) return { error: "at least one photo is required" };

  const kind = KINDS.includes(body.kind) ? body.kind : "everyday";
  const sensitivity = body.sensitivity === "tender" ? "tender" : "normal";

  const tags = Array.from(
    new Set(
      (Array.isArray(body.tags) ? body.tags : [])
        .map((t) => slugify(t))
        .filter(Boolean)
    )
  ).slice(0, MAX_TAGS);

  const entry = {
    id: slugify(body.id) || `${slugify(title)}-${Date.now().toString(36)}`,
    kind,
    title,
    tags,
    photos,
    sensitivity
  };

  // Anchor: either a one-off date (YYYY-MM-DD) or a recurring {month, day}.
  const rec = body.recurring;
  if (rec && Number.isFinite(rec.month) && Number.isFinite(rec.day)) {
    const m = Math.trunc(rec.month);
    const d = Math.trunc(rec.day);
    if (m < 1 || m > 12 || d < 1 || d > 31) return { error: "recurring month/day out of range" };
    entry.recurring = { month: m, day: d };
  } else if (body.date) {
    const iso = String(body.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(iso))) {
      return { error: "date must be YYYY-MM-DD" };
    }
    entry.date = iso;
  }

  const cm = Number(body.cooldownMonths);
  entry.cooldownMonths = Number.isFinite(cm)
    ? Math.min(24, Math.max(1, Math.trunc(cm)))
    : (sensitivity === "tender" ? 12 : 6);

  return { entry };
}

async function loadAuthored() {
  try {
    const raw = await readFile(AUTHORED_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.id) : [];
  } catch {
    return []; // no file yet, or unreadable — treat as empty
  }
}

async function saveAuthored(entries) {
  await mkdir(MEMORIES_DIR, { recursive: true });
  await writeFile(AUTHORED_FILE, JSON.stringify(entries, null, 2), "utf8");
}

router.post("/api/memories", async (req, res) => {
  const { entry, error } = sanitizeEntry(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const entries = await loadAuthored();
    const idx = entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) entries[idx] = entry; // upsert by id (edit an existing one)
    else entries.push(entry);
    await saveAuthored(entries);
    res.json({ ok: true, entry });
  } catch {
    res.status(500).json({ error: "could not save the memory" });
  }
});

router.delete("/api/memories/:id", async (req, res) => {
  const id = String(req.params.id || "");
  try {
    const entries = await loadAuthored();
    const next = entries.filter((e) => e.id !== id);
    if (next.length === entries.length) {
      return res.status(404).json({ error: "no authored memory with that id" });
    }
    await saveAuthored(next);
    res.json({ ok: true, id });
  } catch {
    res.status(500).json({ error: "could not delete the memory" });
  }
});

export default router;
