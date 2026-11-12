import { execFile } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ═══ PHOTO SCREEN — keep an undressed photograph off the living-room wall ═════
   On 2026-11-11 the on-this-day pool put a 2012 hotel panorama on the glass
   whose right-hand end was a person undressed on a bed. The veto
   (photoVeto.js) only works after somebody has seen it.

   This asks the local vision model (the one cameraCaptions.js already runs on
   this box, so no photograph leaves the house) ONE question about each
   photograph in tomorrow's and today's pool, overnight, and keeps the answer.
   A flagged photograph is filtered at the same choke point the veto uses.

   MEASURED 2026-11-11 on the G11, before this was built:
     · the known-bad panorama (6668x1440): YES — but only when cut into square
       tiles. Whole, downscaled to 896 or 1344 px, the model said NO; the figure
       is 5% of the frame. Tiled it answered NO NO NO NO YES, the YES on the
       tile that holds it.
     · false alarms and cost over the rest of that day's pool are in the
       message of the commit that added this file.
   ⚠ RECALL IS ONE PHOTOGRAPH. This is a net with unknown holes, not a
   guarantee; the veto stays the backstop.

   ⚠ IT FAILS OPEN. A photograph not yet screened, a model that is down, an
   answer that is neither YES nor NO — all leave the photograph showable,
   exactly as before this existed. Two earlier quality filters were rejected
   here for dropping real memories; a screen that hides what it could not read
   would be a third.

   ⚠ ITS LIST IS NOT THE VETO LIST. The veto is the room's own word and has an
   undo; this is a model's guess and needs a review. Mixing them would make
   "bring that back" restore the wrong thing and leave no way to tell which
   photographs a person never chose to hide. `allow(id)` is the review.

   Off unless PHOTO_SCREEN=1 (read per tick). The filter itself is unconditional
   because the list starts empty — the same argument photoVeto.js makes.
   ═══════════════════════════════════════════════════════════════════════════ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, "..", "..", "data", "photos", "screened.json");
let overrideFile = null;

export const PROMPT =
  "Look at the whole photograph, including its edges and any dark areas. " +
  "Is any person in it naked, or showing bare buttocks, bare breasts or genitals, or wearing only underwear? " +
  "Swimwear at a beach or pool does not count. Answer with exactly one word: YES or NO.";

/* The second question, off unless PHOTO_SCREEN_DOCS=1: a photograph OF a page
   is not a memory. On 2026-11-12 the wall showed a 2013 newspaper clipping as
   "on this day". MEASURED that afternoon on the G11, this wording, whole frame
   at 896 px, over that day's pool of 41: YES on the clipping, NO on the other
   40, 0 errors, ~55 s each. ⚠ Recall is ONE photograph here too. Same store,
   same choke point, same review; its verdicts are kept apart (`docs`) so each
   photograph is asked each question once. */
export const DOC_PROMPT =
  "Is this a photograph OF a document: a newspaper or magazine page, a printed or handwritten page, a letter, " +
  "a form, a receipt, a ticket, or a screenshot of a phone or computer screen? " +
  "A photograph of people, animals or a place that merely has some writing in it does not count. " +
  "Answer with exactly one word: YES or NO.";

export function docsEnabled() {
  return process.env.PHOTO_SCREEN_DOCS === "1";
}

export const TILE_PX = 896;
/* Quiet hours only. A pool is about an hour of four cores at the voice units'
   own priority (cameraCaptions.js spawnArgs), so it runs while nobody is
   talking to the wall. */
export const WINDOW_START_HOUR = 0;
export const WINDOW_END_HOUR = 5;
const TICK_MS = 30 * 60 * 1000;
const FFMPEG_TIMEOUT_MS = 20 * 1000;

export function enabled() {
  return process.env.PHOTO_SCREEN === "1";
}

export function inWindow(date = new Date()) {
  const h = date.getHours();
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

// --- pure -------------------------------------------------------------------

/**
 * ffmpeg crop filters that cover the frame in square tiles along its long edge,
 * or ["null"] (the whole frame) when it is close enough to square that nothing
 * in it is shrunk away. A 6668x1440 panorama → 5 overlapping 1440 squares.
 */
export function tilePlan(w, h) {
  if (!(w > 0 && h > 0)) return ["null"];
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (long / short < 1.5) return ["null"];
  const n = Math.ceil(long / short);
  return Array.from({ length: n }, (_, i) => {
    const off = Math.round(((long - short) * i) / (n - 1));
    return w >= h ? `crop=${short}:${short}:${off}:0` : `crop=${short}:${short}:0:${off}`;
  });
}

/**
 * The verdict over one photograph's tile answers: "flag", "ok", or null when
 * any answer is neither YES nor NO — an unreadable answer is not a verdict.
 */
export function verdictFrom(answers) {
  if (!Array.isArray(answers) || !answers.length) return null;
  const read = answers.map((a) => /^\s*(yes|no)\b/i.exec(String(a ?? ""))?.[1].toLowerCase());
  if (read.includes("yes")) return "flag";
  return read.every((r) => r === "no") ? "ok" : null;
}

// --- the store ----------------------------------------------------------------

/** `verdicts` is the undressed question, `docs` the document one.
 *  @type {{ verdicts: Record<string, "ok"|"flag"|"allowed">, docs: Record<string, "ok"|"flag"|"allowed"> } | null} */
let state = null;

const readMap = (map) => Object.fromEntries(
  Object.entries(map ?? {}).filter(([, v]) => v === "ok" || v === "flag" || v === "allowed"));

function load() {
  if (state) return state;
  try {
    const raw = JSON.parse(readFileSync(overrideFile ?? DEFAULT_FILE, "utf8"));
    state = { verdicts: readMap(raw?.verdicts), docs: readMap(raw?.docs) };
  } catch {
    // Missing or unreadable: nothing is screened, so nothing is hidden.
    state = { verdicts: {}, docs: {} };
  }
  return state;
}

function persist() {
  try {
    const file = overrideFile ?? DEFAULT_FILE;
    mkdirSync(path.dirname(file), { recursive: true });
    // shortcut: one JSON file, ~45 bytes a photograph, ~1 MB a year at 58 a day; move to jsonl if it ever matters
    writeFileSync(file, JSON.stringify(state));
    return true;
  } catch {
    return false; // the in-memory verdicts stand until the next restart
  }
}

export function verdictOf(id) {
  return load().verdicts[id] ?? null;
}

export function docVerdictOf(id) {
  return load().docs[id] ?? null;
}

/** Has the screen flagged this photograph, with nobody having allowed it since? */
export function isScreenedOut(id) {
  return typeof id === "string" && (load().verdicts[id] === "flag" || load().docs[id] === "flag");
}

const flagsIn = (map) => Object.entries(map).filter(([, v]) => v === "flag").map(([id]) => id);

export function flaggedIds() {
  return [...new Set([...flagsIn(load().verdicts), ...flagsIn(load().docs)])];
}

/** The ones flagged as a document, so the review can tell the two apart. */
export function documentIds() {
  return flagsIn(load().docs);
}

export function counts() {
  const out = { ok: 0, flag: 0, allowed: 0 };
  for (const v of Object.values(load().verdicts)) out[v]++;
  return out;
}

function record(id, verdict, map = "verdicts") {
  load()[map][id] = verdict;
  persist();
}

/** The review: "that one is fine". It is shown again and never re-screened. */
export function allow(id) {
  if (!isScreenedOut(id)) return false;
  for (const map of ["verdicts", "docs"]) if (load()[map][id] === "flag") record(id, "allowed", map);
  return true;
}

/** Tests only — drops the in-memory state so the next read comes from disk. */
export function __reset({ file = null } = {}) {
  state = null;
  if (file !== null) overrideFile = file;
}

// --- the run --------------------------------------------------------------------

/**
 * Ask every question an id has no verdict for yet. Effects are injected:
 *   screenOne(id) → Promise<string[]>   the model's answer per tile
 *   docOne(id)    → Promise<string>     the document question, or null for none
 *   keepGoing()   → boolean             false stops before the next photograph
 *   onFlag(id)                          a photograph was just hidden
 * `screened` counts answers kept, so a photograph asked both counts twice.
 */
export async function screenAssets(ids, { screenOne, docOne = null, keepGoing = () => true, onFlag = () => {}, log = () => {} }) {
  const out = { screened: 0, flagged: 0, errors: 0, known: 0 };
  for (const id of ids) {
    const questions = [
      !verdictOf(id) && ["verdicts", screenOne],
      docOne && !docVerdictOf(id) && !isScreenedOut(id) && ["docs", async (x) => [await docOne(x)]]
    ].filter(Boolean);
    if (!questions.length) { out.known++; continue; }
    if (!keepGoing()) break;
    for (const [map, ask] of questions) {
      if (isScreenedOut(id)) break; // hidden by the first question: the second buys nothing
      try {
        const verdict = verdictFrom(await ask(id));
        if (!verdict) { out.errors++; continue; } // unreadable: stays showable, asked again next run
        record(id, verdict, map);
        out.screened++;
        if (verdict === "flag") {
          out.flagged++;
          log(`flagged ${id}${map === "docs" ? " (document)" : ""}`);
          onFlag(id);
        }
      } catch (err) {
        out.errors++;
        log(`${id} failed: ${String(err?.message || err).slice(0, 120)}`);
      }
    }
  }
  return out;
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args,
      { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: FFMPEG_TIMEOUT_MS, killSignal: "SIGKILL" },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
    child.stdin.on("error", () => { /* the callback above reports the failure */ });
    child.stdin.end(input);
  });
}

/**
 * One photograph → the model's answer per tile, stopping at the first YES.
 *   fetchImage(id) → Promise<Buffer|null>
 *   ask(buffer, { prompt, maxTokens }) → Promise<string>
 */
export async function screenOneWith({ fetchImage, ask }, id) {
  const image = await fetchImage(id);
  if (!image) throw new Error("no image");
  const dims = (await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height", "-of", "csv=p=0", "pipe:0"], image)).toString().trim().split(",").map(Number);
  const answers = [];
  for (const crop of tilePlan(dims[0], dims[1])) {
    const answer = await ask(await tileOf(image, crop), { prompt: PROMPT, maxTokens: 8 });
    answers.push(answer);
    if (/^\s*yes\b/i.test(answer)) break;
  }
  return answers;
}

const tileOf = (image, crop) => run("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf",
  `${crop},scale=w=${TILE_PX}:h=${TILE_PX}:force_original_aspect_ratio=decrease`,
  "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "4", "-f", "image2", "pipe:1"], image);

/** One photograph → the model's answer to the document question, asked of the
 *  whole frame: a page fills it, so nothing is shrunk away. Same effects. */
export async function docOneWith({ fetchImage, ask }, id) {
  const image = await fetchImage(id);
  if (!image) throw new Error("no image");
  return ask(await tileOf(image, "null"), { prompt: DOC_PROMPT, maxTokens: 8 });
}

let running = false;
let timer = null;

export function screenStatus() {
  return { enabled: enabled(), docs: docsEnabled(), running, ...counts() };
}

/**
 * Overnight, screen today's pool and tomorrow's. Tomorrow's is the point: a
 * photograph is judged before the day it could first be shown.
 *   fetchPool(date) → Promise<string[]>  asset ids for that day's pool
 */
export function startPhotoScreen({ fetchPool, screenOne, docOne, onFlag, tickMs = TICK_MS }) {
  if (timer) return;
  const log = (line) => console.log(`[photo-screen] ${line}`);
  const tick = async () => {
    if (running || !enabled() || !inWindow()) return;
    running = true;
    try {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const ids = [...new Set([...(await fetchPool(tomorrow)), ...(await fetchPool(now))])];
      const out = await screenAssets(ids, {
        screenOne, docOne: docsEnabled() ? docOne : null, onFlag, log, keepGoing: () => enabled() && inWindow()
      });
      if (out.screened || out.errors) log(`screened ${out.screened}, flagged ${out.flagged}, errors ${out.errors}, already known ${out.known}`);
    } catch (err) {
      log(`run failed: ${String(err?.message || err).slice(0, 160)}`);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, tickMs);
  timer.unref?.();
}
