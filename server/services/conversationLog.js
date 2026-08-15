import { appendFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { VAULT_DIR } from "./vaultIndex.js";

/* ═══════════════════════════════════════════════════════════════════════════
   CONVERSATION MEMORY — the house remembers past Tuesday.

   Until now the house's memory was eight seconds long: LINGER_MS in
   v3/core/voice.js held six turns in a browser array and then set it to []. A
   page reload, a screensaver, or a walk to the fridge erased everything. The
   vault LOOKED like memory but is a hand-authored knowledge base — read every
   turn, written never.

   Three tiers, which is where the field has settled (working / episodic /
   semantic), each mapped onto something this repo already owns:

     working   — the in-page thread. Still v3/core/voice.js; just given a
                 boundary that is a conversation ending rather than a pause.
     episodic  — this file's JSONL. Dated, bounded, and DELIBERATELY SHORT
                 LIVED. Its only job is to feed the tier below.
     semantic  — consolidated notes written into data/vault/remembered/.

   ⚠ THE LOAD-BEARING DESIGN CHOICE IS THAT CONSOLIDATED MEMORIES ARE VAULT
   NOTES. Retrieval then costs nothing new: searchVault() already scores them,
   buildContext() already wraps them, MAX_NOTES_RETURNED and MAX_CONTEXT_CHARS
   already bound them, and `private: true` already excludes a note from the
   index entirely. No embeddings, no second retrieval path, no new machinery to
   test — the concierge starts remembering because the store it already reads
   from starts having things written into it.

   ⚠ CONSOLIDATION NEVER RUNS INSIDE A TURN. It is a background interval, and
   that is the whole reason memory can get richer without costing latency. A
   turn writes one line to a file and returns.

   PRIVACY. This runs on an always-on kitchen microphone, so:
     - raw exchanges are discarded once distilled (the retention rule below),
     - notes land in their own folder so they are reviewable and bulk-deletable
       rather than tangled up with hand-authored ones,
     - a hard retention sweep runs whether or not consolidation succeeded, so a
       dead API key cannot silently accumulate months of kitchen transcripts,
     - the whole feature is off unless VOICE_MEMORY_ENABLED=1.
   `data/conversations/` and `data/vault/` are both gitignored; the repo is
   public and neither may ever reach it.
   ═══════════════════════════════════════════════════════════════════════════ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const LOG_DIR = path.join(__dirname, "..", "..", "data", "conversations");

/* Their own folder, for the review surface's sake: "everything the house
   decided to remember about us" has to be one listable, deletable thing. */
export const MEMORY_SUBDIR = "remembered";
export const MEMORY_DIR = path.join(VAULT_DIR, MEMORY_SUBDIR);

/* One exchange is two short spoken sentences. 2 KB is generous; the cap exists
   so a malformed or hostile body cannot write an audiobook to the SD card. */
export const MAX_ENTRY_CHARS = 1000;
/* A very talkative day is a few dozen turns. 500 is far above that and bounds
   both the disk and the tokens a consolidation pass can ever be handed. */
export const MAX_ENTRIES_PER_DAY = 500;

/* The safety net, and it is deliberately independent of consolidation. Any log
   older than this is deleted whether or not it was ever distilled — a broken
   API key must degrade to "the house forgets", never to "the house keeps a
   transcript of the kitchen indefinitely". */
export const RAW_RETENTION_DAYS = 3;

/* Six hours: often enough that yesterday is distilled well before anyone asks
   about it, rare enough to be invisible in cost. */
const CONSOLIDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/* Brisbane, not the server's locale — a UTC evening is already tomorrow here,
   and a day boundary ten hours out would file the evening's conversation under
   the wrong date and consolidate it while it was still happening. */
const TZ = "Australia/Brisbane";

export function houseDay(now = new Date()) {
  // en-CA renders as YYYY-MM-DD, which sorts lexically — the property the
  // "is this file today's?" comparison below relies on.
  return now.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function memoryEnabled() {
  // Read per call, never at module load: server.js's static imports all
  // evaluate before its dotenv.config().
  return process.env.VOICE_MEMORY_ENABLED === "1";
}

const logPathFor = (day) => path.join(LOG_DIR, `${day}.jsonl`);

/* ── Episodic: write the exchange down ──────────────────────────────────── */

/**
 * Record one exchange. Fire-and-forget by contract: never throws, and the
 * caller must not await it on the turn's critical path.
 *
 * A turn where the house said nothing is still recorded — an utterance it
 * could not act on is a thing a person said, and dropping it makes the repair
 * turn read as the first one. Same reasoning as endTurn() in v3/core/voice.js.
 */
export async function recordExchange({ said, replied } = {}) {
  if (!memoryEnabled()) return false;

  const user = typeof said === "string" ? said.trim().slice(0, MAX_ENTRY_CHARS) : "";
  if (!user) return false;                    // nothing was said; nothing to record
  const house = typeof replied === "string" ? replied.trim().slice(0, MAX_ENTRY_CHARS) : "";

  try {
    await mkdir(LOG_DIR, { recursive: true });
    const file = logPathFor(houseDay());

    // Bound the file before appending rather than after. A runaway loop that
    // discovers its ceiling only on the next pass has already written the day.
    const existing = await countLines(file);
    if (existing >= MAX_ENTRIES_PER_DAY) return false;

    await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), said: user, replied: house })}\n`, "utf8");
    return true;
  } catch (err) {
    // The room got its answer. A memory that could not be written is worth one
    // warning and nothing else.
    console.warn("[memory] could not record exchange:", err.message);
    return false;
  }
}

async function countLines(file) {
  try {
    const raw = await readFile(file, "utf8");
    return raw.split("\n").filter(Boolean).length;
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }
}

/** Parse a day's log. A single corrupt line costs that line, never the day. */
export function parseLog(raw) {
  const out = [];
  for (const line of String(raw ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry.said === "string" && entry.said.trim()) out.push(entry);
    } catch { /* a half-written line from a hard kill mid-append */ }
  }
  return out;
}

/* ── Semantic: distil, then forget the raw text ─────────────────────────── */

/* Structured output rather than "reply with JSON": the schema is enforced, so
   a consolidation pass cannot half-produce a note and leave a broken file in
   the vault the concierge then quotes from. */
const MEMORY_SCHEMA = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short noun phrase naming the fact. No date in it." },
          tags: { type: "array", items: { type: "string" }, description: "3-6 lowercase single words someone might later say out loud." },
          body: { type: "string", description: "One or two plain sentences stating the fact and who it concerns." }
        },
        required: ["title", "tags", "body"],
        additionalProperties: false
      }
    }
  },
  required: ["memories"],
  additionalProperties: false
};

/* The distillation instruction. The bar is deliberately high: a house that
   remembers everything is a surveillance device, and a vault full of "they
   asked about the weather" is also a vault whose retrieval scores are diluted
   into uselessness. Most days should produce nothing, and that is correct. */
const CONSOLIDATE_SYSTEM = [
  "You are distilling one day of spoken exchanges between a household and their home dashboard into durable notes.",
  "Extract ONLY facts that will still be worth knowing in a month: preferences, plans, names and relationships, decisions, recurring arrangements, things about the house itself.",
  "Ignore anything transient — questions about the weather, the time, what's playing, whether the bins are out. Those are answered fresh every time and are worthless as memory.",
  "Ignore the dashboard's own side of the conversation as a source of fact; it may be wrong, and a note that records the house's own guess back to itself is how an error becomes permanent.",
  "Do NOT record anything about health, money, or conflict between people unless it is plainly practical and clearly volunteered (an appointment time is practical; a diagnosis is not).",
  "If a transcript line is garbled or you cannot tell what was meant, skip it — speech recognition misfires and a confidently recorded mishearing is worse than a gap.",
  "Write each note as a plain statement of fact, in the third person, naming people rather than saying \"you\".",
  "Most days contain nothing worth keeping. Returning an empty list is the correct and expected outcome — do not invent significance to fill the array.",
  "Return at most 5 notes."
].join(" ");

let anthropic = null;
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });
  }
  return anthropic;
}

/** The transcript as the model sees it. Bounded by MAX_ENTRIES_PER_DAY above. */
export function renderTranscript(entries) {
  return entries
    .map((e) => `Person: ${e.said}${e.replied ? `\nHouse: ${e.replied}` : ""}`)
    .join("\n\n");
}

/**
 * Distil one day's entries into notes. Returns [] when there is nothing worth
 * keeping, which is the common and correct case.
 */
export async function distil(entries) {
  const client = getAnthropic();
  if (!client || !entries.length) return [];

  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    max_tokens: 1500,
    system: CONSOLIDATE_SYSTEM,
    output_config: { format: { type: "json_schema", schema: MEMORY_SCHEMA } },
    messages: [{ role: "user", content: renderTranscript(entries) }]
  });

  const text = msg.content.find((b) => b.type === "text")?.text ?? "";
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.memories) ? parsed.memories.slice(0, 5) : [];
  } catch {
    console.warn("[memory] consolidation returned unparseable output; skipping");
    return [];
  }
}

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "note";

/* ⚠ NO `date`, `until` OR `label` IN THIS FRONTMATTER, EVER.
   Those three keys are not metadata in this vault — they open a photo-caption
   span (docs/design/VAULT.md, "The date grain"). A memory note dated today
   with a label would start captioning today's photographs with whatever the
   kitchen was talking about. The day is written into the body as prose
   instead, where it is readable and inert.

   `kind: memory` marks provenance so a person reading the vault can tell what
   the house wrote from what they wrote. */
export function renderNote({ title, tags, body }, day) {
  const clean = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t).toLowerCase().replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
  return [
    "---",
    `title: ${String(title).replace(/\n/g, " ").trim()}`,
    `tags: [${["memory", ...clean].join(", ")}]`,
    "kind: memory",
    "private: false",
    "---",
    String(body).trim(),
    "",
    `_Remembered by the house from a conversation on ${day}._`,
    ""
  ].join("\n");
}

/**
 * Consolidate every log that is not today's, then delete it.
 *
 * Today's file is deliberately left alone: the day is still happening, the
 * in-page thread already covers it, and distilling a conversation mid-sentence
 * produces worse notes than waiting a few hours.
 */
export async function consolidateOnce(now = new Date()) {
  if (!memoryEnabled()) return { consolidated: 0, notes: 0 };

  let files;
  try {
    files = await readdir(LOG_DIR);
  } catch (err) {
    if (err.code === "ENOENT") return { consolidated: 0, notes: 0 };
    throw err;
  }

  const today = houseDay(now);
  let consolidated = 0;
  let notes = 0;

  for (const name of files.filter((f) => f.endsWith(".jsonl")).sort()) {
    const day = name.replace(/\.jsonl$/, "");
    if (day >= today) continue;                       // still being written to

    const file = path.join(LOG_DIR, name);
    try {
      const entries = parseLog(await readFile(file, "utf8"));
      const memories = await distil(entries);

      if (memories.length) {
        await mkdir(MEMORY_DIR, { recursive: true });
        for (const memory of memories) {
          const target = path.join(MEMORY_DIR, `${day}-${slug(memory.title)}.md`);
          await writeFile(target, renderNote(memory, day), "utf8");
          notes += 1;
        }
      }

      // The raw text goes, distilled or not. That is the retention promise,
      // and making it conditional on a successful pass would quietly turn a
      // model outage into an indefinite transcript.
      await unlink(file);
      consolidated += 1;
    } catch (err) {
      console.warn(`[memory] consolidating ${name} failed:`, err.message);
    }
  }

  await sweepStaleLogs(now);
  return { consolidated, notes };
}

/**
 * Delete raw logs past the retention window regardless of consolidation.
 *
 * This is the backstop for the case consolidateOnce() cannot cover: no API
 * key, a persistently failing model, an unwritable vault. Any of those would
 * otherwise leave the loop above throwing on the same file every six hours
 * while the kitchen's transcripts piled up behind it.
 */
export async function sweepStaleLogs(now = new Date()) {
  const cutoff = now.getTime() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let files;
  try {
    files = await readdir(LOG_DIR);
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }

  let removed = 0;
  for (const name of files.filter((f) => f.endsWith(".jsonl"))) {
    const file = path.join(LOG_DIR, name);
    try {
      if ((await stat(file)).mtimeMs < cutoff) {
        await unlink(file);
        removed += 1;
      }
    } catch (err) {
      if (err.code !== "ENOENT") console.warn(`[memory] sweep failed for ${name}:`, err.message);
    }
  }
  return removed;
}

/* ── The review surface ─────────────────────────────────────────────────────
   A house that writes notes about kitchen conversations needs a page where
   those notes can be read and deleted. This is not a nice-to-have bolted on
   afterwards; it is the thing that makes automatic memory acceptable at all.

   Read from DISK rather than from the vault index: the index re-scans on a ten
   minute timer, so a note written twenty seconds ago would not be listed, and
   "I just told it to forget that and it's still there" is exactly the wrong
   experience for this particular feature.
─────────────────────────────────────────────────────────────────────────── */

/* Titles come from a model, filenames from titles, and ids come back over
   HTTP. `..`, a slash, or an absolute path must not escape MEMORY_DIR —
   resolve and confirm containment rather than trusting the string. */
function memoryPath(id) {
  const name = `${path.basename(String(id ?? ""))}.md`;
  const target = path.resolve(MEMORY_DIR, name);
  if (path.dirname(target) !== path.resolve(MEMORY_DIR)) return null;
  return target;
}

/** Every note the house has written about this household. */
export async function listMemories() {
  let files;
  try {
    files = await readdir(MEMORY_DIR);
  } catch (err) {
    if (err.code === "ENOENT") return [];        // nothing remembered yet
    throw err;
  }

  const out = [];
  for (const name of files.filter((f) => f.endsWith(".md")).sort().reverse()) {
    try {
      const raw = await readFile(path.join(MEMORY_DIR, name), "utf8");
      const title = raw.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? name.replace(/\.md$/, "");
      // The day is the filename prefix the consolidator wrote, which is why
      // it is not in the frontmatter — see renderNote() on the `date` key.
      const day = name.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1] ?? null;
      const body = raw.split(/^---$/m)[2]?.trim() ?? "";
      out.push({ id: name.replace(/\.md$/, ""), title, day, body });
    } catch { /* a note mid-write; it will list on the next call */ }
  }
  return out;
}

/** Forget one. Returns false when it was already gone, which is not an error. */
export async function forgetMemory(id) {
  const target = memoryPath(id);
  if (!target) return false;
  try {
    await unlink(target);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

/** Forget all of it. The escape hatch this feature is not allowed to lack. */
export async function forgetAllMemories() {
  let files;
  try {
    files = await readdir(MEMORY_DIR);
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }
  let removed = 0;
  for (const name of files.filter((f) => f.endsWith(".md"))) {
    try {
      await unlink(path.join(MEMORY_DIR, name));
      removed += 1;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  return removed;
}

/**
 * Start the background consolidator. Init-once at boot, like startTtsWarmer().
 *
 * unref'd so a pending timer can never hold the process open on shutdown, and
 * the first pass is deferred rather than run at boot — startup is the one
 * moment the Pi is busy, and yesterday's conversation can wait five minutes.
 */
export function startMemoryConsolidator() {
  if (!memoryEnabled()) return;

  /* The one silent misconfiguration this feature has. Consolidation WRITES
     into the vault; only VAULT_ENABLED makes the vault READABLE at answer
     time. With memory on and the vault off, everything below runs perfectly,
     costs a model call a day, and the house never recalls a word of it — a
     failure with no symptom other than the thing not working. Say so once at
     boot rather than letting somebody debug the prompt for an afternoon. */
  if (process.env.VAULT_ENABLED !== "1") {
    console.warn(
      "[memory] VOICE_MEMORY_ENABLED=1 but VAULT_ENABLED is not 1 — " +
      "the house will write memories it can never read back. Set VAULT_ENABLED=1."
    );
  }

  const run = () => {
    consolidateOnce().catch((err) => console.warn("[memory] consolidation pass failed:", err.message));
  };
  setTimeout(run, 5 * 60 * 1000).unref();
  setInterval(run, CONSOLIDATE_INTERVAL_MS).unref();
}
