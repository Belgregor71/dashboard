import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// House knowledge base — the read half of an Obsidian vault (docs/design/VAULT.md).
//
// The vault is a folder of markdown notes with YAML frontmatter, authored in
// Obsidian on a PC/phone and pulled onto the Pi by the deploy service. Obsidian
// itself never runs here: a vault is plain files, so this is a directory read,
// exactly like data/memories/*.json. The Local REST API plugin is deliberately
// NOT used — it only serves while the desktop app is open.
//
// Everything above buildIndex() is pure (no imports, no I/O) and unit-tested
// directly in tests/vault.spec.js, the voiceShape.js precedent.
//
// PRIVACY: retrieved note text is sent to Anthropic on the concierge's Claude
// leg. `private: true` in a note's frontmatter keeps it out of the index
// entirely — it is never read into memory, so it can never be retrieved.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const VAULT_DIR = path.join(__dirname, "..", "..", "data", "vault");

// Bounds are mandatory here, not defensive: this runs for weeks on a Pi and
// feeds a metered API. Every one of these caps something unbounded — the number
// of files walked, the bytes of any one note, the notes quoted into a prompt,
// and the characters that prompt can carry.
export const MAX_FILES = 500;
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_CONTEXT_CHARS = 4000;
export const MAX_NOTES_RETURNED = 3;

// One matched term anywhere is enough to retrieve. Tuned toward RECALL after a
// live probe: "who is the plumber" scored 2 on a body-only hit and a stricter
// floor answered "I don't know" to a question the vault plainly answered — the
// one failure that makes this whole lane worthless. Over-retrieval is cheap by
// comparison: the prompt tells the model to ignore notes that don't cover the
// question, and only the top MAX_NOTES_RETURNED are quoted anyway. Stopwords
// are already gone by this point, so a match here is never a function word.
export const SCORE_FLOOR = 2;

const REINDEX_MS = 10 * 60 * 1000;

// Skipped whole-directory: Obsidian's own config/plugin tree, its soft-delete
// folder, and any other dot-directory (.git for the vault's own clone).
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git"]);

// ── frontmatter (pure) ─────────────────────────────────────────

// A restricted YAML subset, hand-rolled rather than pulled in as a dependency:
// the note conventions are ours to define (docs/design/VAULT.md), and the whole
// surface is four keys. Supported forms, which is everything Obsidian's property
// editor emits for them:
//   key: value          key: true          key: [a, b]
//   key:
//     - a
//     - b
// Anything else is ignored rather than thrown on — an unparseable property must
// cost that property, never the note.
function parseFrontmatter(block) {
  const out = {};
  const lines = block.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    // Only top-level keys; an indented line is a block-list item consumed below.
    if (/^\s/.test(line)) continue;

    const sep = line.indexOf(":");
    if (sep < 1) continue;

    const key = line.slice(0, sep).trim().toLowerCase();
    const rest = line.slice(sep + 1).trim();

    if (rest) {
      out[key] = parseScalar(rest);
      continue;
    }

    // Empty value → look ahead for an indented "- item" block list.
    const items = [];
    while (i + 1 < lines.length && /^\s+-\s*/.test(lines[i + 1])) {
      items.push(unquote(lines[++i].replace(/^\s+-\s*/, "").trim()));
    }
    out[key] = items.filter(Boolean);
  }

  return out;
}

function unquote(s) {
  const t = String(s).trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => unquote(s))
      .filter(Boolean);
  }
  return unquote(v);
}

function toTags(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  return Array.from(
    new Set(
      list
        // Obsidian writes inline tags as "#trip" and nested ones as "trip/2019";
        // both should match the plain word a person would say out loud.
        .map((t) => String(t).trim().toLowerCase().replace(/^#/, ""))
        .filter(Boolean)
    )
  ).slice(0, 24);
}

// One note's raw text → the indexed shape. `relPath` is the vault-relative path,
// which doubles as the stable id (Obsidian has no other per-note identifier).
export function parseNote(raw, relPath) {
  // Strip a UTF-8 BOM before anything else. Node's readFile(…,"utf8") leaves it
  // in, and it would sit in front of the opening "---" so the frontmatter regex
  // below never matches — the note would index with its filename as the title
  // and no tags, silently. Windows tooling emits one readily (PowerShell 5.1's
  // Set-Content -Encoding utf8 always does), even though Obsidian itself does not.
  const text = (typeof raw === "string" ? raw : "").replace(/^﻿/, "");
  const id = String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "");

  let meta = {};
  let body = text;

  // Frontmatter is only frontmatter on line 1 — this is Obsidian's own rule, and
  // it keeps a "---" horizontal rule mid-note from being read as a delimiter.
  // The closing delimiter must be "---" ALONE on its line, so a body line of
  // "----" does not truncate the block; it may end the file with no newline.
  const open = /^---\r?\n/.exec(text);
  if (open) {
    const close = /\r?\n---[ \t]*(\r?\n|$)/.exec(text.slice(open[0].length));
    if (close) {
      const from = open[0].length;
      meta = parseFrontmatter(text.slice(from, from + close.index));
      body = text.slice(from + close.index + close[0].length);
    }
  }

  const title = typeof meta.title === "string" && meta.title.trim()
    ? meta.title.trim()
    : id.split("/").pop() || id;

  return {
    id,
    title,
    tags: toTags(meta.tags),
    kind: typeof meta.kind === "string" && meta.kind.trim() ? meta.kind.trim().toLowerCase() : null,
    private: meta.private === true,
    body: body.trim()
  };
}

// ── retrieval (pure) ───────────────────────────────────────────

// Spoken questions are mostly function words; without this every note matches
// every question and the score floor stops meaning anything.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "do", "does", "did", "have", "has", "had", "what", "when", "where", "who",
  "which", "how", "why", "we", "i", "you", "it", "our", "my", "your", "of",
  "to", "in", "on", "at", "for", "with", "that", "this", "there", "from",
  "about", "again", "get", "got", "can", "tell", "me", "s", "t"
]);

export function tokenize(text) {
  return Array.from(
    new Set(
      String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    )
  );
}

// Distinct query terms matched per field, weighted by field. Counting DISTINCT
// terms rather than occurrences is deliberate: occurrence counting would let one
// long note beat a short, exactly-on-topic one just by being long.
export function scoreNote(note, query) {
  const terms = tokenize(query);
  if (!note || terms.length === 0) return 0;

  const title = String(note.title || "").toLowerCase();
  const tags = (note.tags || []).join(" ").toLowerCase();
  const body = String(note.body || "").toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 5;
    else if (tags.includes(term)) score += 3;
    else if (body.includes(term)) score += 2;
  }
  return score;
}

export function retrieve(notes, query, { max = MAX_NOTES_RETURNED, floor = SCORE_FLOOR } = {}) {
  if (!Array.isArray(notes) || notes.length === 0) return [];
  return notes
    .map((note) => ({ note, score: scoreNote(note, query) }))
    .filter((hit) => hit.score >= floor)
    .sort((a, b) => b.score - a.score || a.note.id.localeCompare(b.note.id))
    .slice(0, Math.max(0, max))
    .map((hit) => hit.note);
}

// Retrieved notes → the block quoted into the system prompt. Bounded twice: the
// whole block, and each note's share of it, so one long note cannot crowd the
// other two out entirely.
export function buildContext(notes, { maxChars = MAX_CONTEXT_CHARS } = {}) {
  if (!Array.isArray(notes) || notes.length === 0) return "";

  const perNote = Math.floor(maxChars / notes.length);
  const blocks = [];
  let used = 0;

  for (const note of notes) {
    const body = String(note.body || "").slice(0, perNote);
    const block = `<note title="${note.title}">\n${body}\n</note>`;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n");
}

// ── index (the only I/O) ───────────────────────────────────────

let index = { notes: [], indexedAt: null };
// path → { mtimeMs, note }. An unchanged vault costs one stat per file and zero
// reads, so the 10-minute reindex is nearly free on the Pi's SD card.
let cache = new Map();
let timer = null;

async function walk(dir, base, found) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — an absent vault is a valid cold start
  }

  for (const entry of entries) {
    if (found.length >= MAX_FILES) return;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await walk(full, base, found);
      continue;
    }
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    found.push({ full, rel: path.relative(base, full) });
  }
}

export async function buildIndex(dir = VAULT_DIR) {
  const found = [];
  await walk(dir, dir, found);

  const notes = [];
  const nextCache = new Map();

  for (const file of found) {
    try {
      const info = await stat(file.full);
      if (info.size > MAX_FILE_BYTES) continue;

      const hit = cache.get(file.full);
      if (hit && hit.mtimeMs === info.mtimeMs) {
        nextCache.set(file.full, hit);
        if (hit.note) notes.push(hit.note);
        continue;
      }

      const parsed = parseNote(await readFile(file.full, "utf8"), file.rel);
      // A private note is dropped here, before it is ever held in the index —
      // cached as null so it is not re-read on every pass.
      const note = parsed.private ? null : parsed;
      nextCache.set(file.full, { mtimeMs: info.mtimeMs, note });
      if (note) notes.push(note);
    } catch {
      /* one unreadable note must never break the whole vault (memories.js:49) */
    }
  }

  cache = nextCache;
  index = { notes, indexedAt: new Date().toISOString() };
  return index;
}

export function getIndex() {
  return index;
}

// Retrieve against the live index. The concierge's entry point.
export function searchVault(query, opts) {
  return retrieve(index.notes, query, opts);
}

// Init-once interval at startup, which the kiosk memory rules permit outright
// (the leak class is per-event timers, not this). Never started unless the
// vault lane is enabled, so the off-state does no I/O at all.
export async function startVaultIndex() {
  await buildIndex();
  console.log(`[vault] indexed ${index.notes.length} note(s) from ${VAULT_DIR}`);
  if (!timer) {
    timer = setInterval(() => {
      buildIndex().catch((err) => console.error("[vault] reindex failed:", err.message));
    }, REINDEX_MS);
    timer.unref?.(); // never hold the process open on its own account
  }
  return index;
}
