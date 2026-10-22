import { spawn } from "child_process";
import { createHash } from "crypto";
import { readFile, writeFile, appendFile, mkdir, rename } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

/* ═══ CAMERA CAPTIONS — field-scan #3 "what did I miss", PHASE 1 (SHADOW) ═════
   A motion edge from a camera → wait for that camera's NEW event image → one
   sentence from a local vision model → a row on disk. Nothing reaches the wall:
   Phase 1 exists to read real captions for a few days before a card is built.

   Phase 0 (2026-10-22, docs/research/FIELD-SCAN.md #3): Gemma 4 E4B invented a
   person in 1 of 187 owner-marked frames and missed 4 of 40; the G11 gave the
   same verdict as the GPU box on 30/30 at a median 34 s per frame.

   OWNER'S RULINGS (2026-10-22):
     · THE MODEL RUNS ON THIS BOX, ON DEMAND. Images never leave it. llama-server
       is spawned for a burst and killed after IDLE_MS. Measured: healthy in
       ~6 s, ~2.9 GB private memory (+4.4 GB of reclaimable file pages, the
       mapped model) with -c 2048. The default context costs 2 GB more.
     · ROWS ON DISK, 7 DAYS, UNTRACKED (data/camera-captions.jsonl). A row is
       camera + times + the model's sentence. The model has no names to give, so
       no name can enter a row; the face sensor is never read here.

   ⚠ THE EVENT IMAGE LAGS THE MOTION EDGE by a minute or more (camera-debug
   skill). Captioning on the edge captions the PREVIOUS event, so each edge
   opens a watch window and only an image whose hash differs from the last one
   this camera showed is captioned.

   Off unless CAMERA_CAPTIONS=1. Read per call, never at module load. Either
   CAPTION_URL (an already-running OpenAI-compatible server) or the three
   CAPTION_LLAMA_* paths (spawned here) must be set.
   ═══════════════════════════════════════════════════════════════════════════ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "..", "data");
const FILE = path.join(DIR, "camera-captions.jsonl");

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ROWS = 5000;
export const WATCH_MS = 3 * 60 * 1000;     // how long after an edge to wait for the new image
export const POLL_MS = 20 * 1000;
export const BURST_GAP_MS = 5 * 60 * 1000; // edges closer than this are one burst
export const MAX_QUEUE = 12;               // a backlog beyond this is dropped, not buffered
export const IDLE_MS = 5 * 60 * 1000;
const CAPTION_TIMEOUT_MS = 180 * 1000;     // worst Phase 0 frame on the G11: 109 s
const HEALTH_TIMEOUT_MS = 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const CAPTION_MAX = 240;

const MOTION_RE = /^binary_sensor\.(\w+)_(?:motion|person)_detected$/;
const RING_ENTITY = "binary_sensor.doorbell_ringing";

export const PROMPT =
  "This is a security camera frame. In one short sentence, say what is happening. " +
  "Mention a person or vehicle only if one is clearly visible. " +
  "If nothing is happening, reply exactly: Nothing.";

export function enabled() {
  return process.env.CAMERA_CAPTIONS === "1";
}

/** The camera an HA entity's `on` edge belongs to, or null. Pure. */
export function cameraForEntity(entityId, cameraIds) {
  if (entityId === RING_ENTITY) return cameraIds.has("doorbell") ? "doorbell" : null;
  const m = MOTION_RE.exec(entityId || "");
  return m && cameraIds.has(m[1]) ? m[1] : null;
}

/** Rows inside the retention window, newest MAX_ROWS kept. Pure. */
export function prune(rows, now = Date.now()) {
  const floor = now - RETENTION_MS;
  const kept = rows.filter((r) => Number.isFinite(r?.at) && r.at >= floor);
  return kept.length > MAX_ROWS ? kept.slice(kept.length - MAX_ROWS) : kept;
}

// --- the model -------------------------------------------------------------

/** One sentence for one JPEG from an OpenAI-compatible server. Thinking off. */
export async function captionImage(baseUrl, buffer, { timeoutMs = CAPTION_TIMEOUT_MS } = {}) {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: "gemma-4-e4b-it",
      temperature: 0,
      max_tokens: 80,
      // Gemma 4 thinks by default and spends the whole budget doing it.
      // llama-server reads the template kwarg; LM Studio only reasoning_effort.
      chat_template_kwargs: { enable_thinking: false },
      reasoning_effort: "none",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${buffer.toString("base64")}` } },
          { type: "text", text: PROMPT }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error(`caption server HTTP ${res.status}`);
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("caption server returned no text");
  return text.trim().replace(/\s+/g, " ").slice(0, CAPTION_MAX);
}

/* The spawned llama-server. Killed by its own PID, never by a name match. */
let child = null;
let childReady = null;
let idleTimer = null;

function spawnConfig() {
  const bin = process.env.CAPTION_LLAMA_SERVER;
  const model = process.env.CAPTION_LLAMA_MODEL;
  const mmproj = process.env.CAPTION_LLAMA_MMPROJ;
  if (!bin || !model || !mmproj) return null;
  return { bin, model, mmproj, port: Number(process.env.CAPTION_PORT) || 8099 };
}

function stopServer(reason) {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (!child) return;
  console.log(`[captions] model server stopped (${reason})`);
  try { child.kill("SIGTERM"); } catch { /* already gone */ }
  child = null;
  childReady = null;
}

async function waitHealthy(base, proc) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`model server exited ${proc.exitCode}`);
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch { /* still loading */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("model server never became healthy");
}

/** Base URL of a server ready to caption, spawning one if this box runs its own. */
async function ensureServer() {
  if (process.env.CAPTION_URL) return process.env.CAPTION_URL.replace(/\/+$/, "");
  const cfg = spawnConfig();
  if (!cfg) throw new Error("no CAPTION_URL and no CAPTION_LLAMA_* paths");
  const base = `http://127.0.0.1:${cfg.port}`;
  clearTimeout(idleTimer);
  if (!child) {
    const t0 = Date.now();
    const proc = spawn(cfg.bin, [
      "-m", cfg.model, "--mmproj", cfg.mmproj, "--jinja",
      "-t", "4", "-c", "2048", "-np", "1",
      "--host", "127.0.0.1", "--port", String(cfg.port)
    ], { stdio: "ignore" });
    proc.on("error", () => { /* surfaced by waitHealthy via exitCode / timeout */ });
    proc.on("exit", () => { if (child === proc) { child = null; childReady = null; } });
    child = proc;
    childReady = waitHealthy(base, proc).then(
      () => console.log(`[captions] model server up in ${Date.now() - t0} ms (pid ${proc.pid})`),
      (err) => { stopServer("failed to start"); throw err; }
    );
  }
  await childReady;
  return base;
}

function armIdle() {
  clearTimeout(idleTimer);
  if (!child) return;
  idleTimer = setTimeout(() => stopServer("idle"), IDLE_MS);
  idleTimer.unref?.();
}

process.on("exit", () => { if (child) try { child.kill("SIGTERM"); } catch { /* gone */ } });

// --- the store ---------------------------------------------------------------

async function readRows() {
  let raw = "";
  try { raw = await readFile(FILE, "utf8"); } catch { return []; }
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line is dropped, not fatal */ }
  }
  return rows;
}

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
  if (kept.length !== rows.length) {
    await mkdir(DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length ? "\n" : ""), "utf8");
    await rename(tmp, FILE);
  }
  lastPrune = now;
  return kept;
}

export function appendRow(row) {
  return serial(async () => {
    await mkdir(DIR, { recursive: true });
    await appendFile(FILE, JSON.stringify(row) + "\n", "utf8");
    if (row.at - lastPrune > PRUNE_EVERY_MS) await pruneFile(row.at);
  });
}

/** Newest first, inside retention. */
export function readCaptions({ since = 0, limit = 50, now = Date.now() } = {}) {
  return serial(async () => {
    const rows = now - lastPrune > PRUNE_EVERY_MS ? await pruneFile(now) : prune(await readRows(), now);
    return rows.filter((r) => r.at >= since).reverse().slice(0, limit);
  });
}

// --- the lane ------------------------------------------------------------------

/**
 * The edge → new image → caption → row machine, with every outside effect
 * injected so the spec can drive it without HA, a model or a disk.
 *   fetchImage(cameraId) → Promise<Buffer>
 *   caption(buffer)      → Promise<string>
 *   write(row)           → Promise
 */
export function createCaptionLane({
  cameraIds, fetchImage, caption, write,
  now = Date.now, pollMs = POLL_MS, watchMs = WATCH_MS, burstGapMs = BURST_GAP_MS,
  maxQueue = MAX_QUEUE, log = (line) => console.log(`[captions] ${line}`)
}) {
  const cams = new Map(); // id → { lastHash, watchUntil, lastEdge, burst, polling }
  const queue = [];
  let working = false;
  const stats = { edges: 0, images: 0, captioned: 0, dropped: 0, errors: 0, lastError: null };

  const cam = (id) => {
    if (!cams.has(id)) cams.set(id, { lastHash: undefined, watchUntil: 0, lastEdge: 0, burst: 0, polling: false });
    return cams.get(id);
  };

  async function drain() {
    if (working) return;
    working = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        const t0 = now();
        try {
          const text = await caption(job.buffer);
          const row = { at: job.imageAt, camera: job.camera, burst: job.burst, caption: text, ms: now() - t0 };
          await write(row);
          stats.captioned++;
          log(`${job.camera} ${row.ms} ms "${text}"`);
        } catch (err) {
          stats.errors++;
          stats.lastError = String(err?.message || err).slice(0, 160);
          log(`${job.camera} caption failed: ${stats.lastError}`);
        }
      }
    } finally {
      working = false;
    }
  }

  async function poll(id) {
    const c = cam(id);
    if (c.polling) return;
    c.polling = true;
    try {
      while (now() <= c.watchUntil) {
        try {
          const buffer = await fetchImage(id);
          const hash = createHash("md5").update(buffer).digest("hex");
          if (c.lastHash === undefined) {
            // First look since boot: whatever is showing predates this lane.
            c.lastHash = hash;
          } else if (hash !== c.lastHash) {
            c.lastHash = hash;
            stats.images++;
            if (queue.length >= maxQueue) {
              stats.dropped++;
              log(`${id} image dropped, queue full`);
            } else {
              queue.push({ camera: id, burst: c.burst, imageAt: now(), buffer });
              drain();
            }
          }
        } catch (err) {
          stats.lastError = String(err?.message || err).slice(0, 160);
        }
        if (now() + pollMs > c.watchUntil) break;
        await new Promise((r) => setTimeout(r, pollMs));
      }
    } finally {
      c.polling = false;
    }
  }

  return {
    /** An HA `on` edge. Returns the camera it counted for, or null. */
    noteEdge(entityId, at = now()) {
      const id = cameraForEntity(entityId, cameraIds);
      if (!id) return null;
      stats.edges++;
      const c = cam(id);
      if (at - c.lastEdge > burstGapMs) c.burst = at;
      c.lastEdge = at;
      c.watchUntil = Math.max(c.watchUntil, at + watchMs);
      poll(id);
      return id;
    },
    status() {
      return { ...stats, queued: queue.length, working, watching: [...cams].filter(([, c]) => c.polling).map(([id]) => id) };
    },
    idle: () => !working && queue.length === 0 && [...cams.values()].every((c) => !c.polling)
  };
}

// --- wiring ------------------------------------------------------------------

let lane = null;

export function captionStatus() {
  return {
    enabled: enabled(),
    server: process.env.CAPTION_URL ? "external" : child ? "running" : "stopped",
    ...(lane ? lane.status() : {})
  };
}

/**
 * Listens to HA `on` edges. Inert when CAMERA_CAPTIONS is not "1" at the time of
 * the edge, so flipping the env var and restarting is the whole switch.
 */
export function startCameraCaptions({ manager, cameraIds, fetchImage, timing = {} }) {
  if (!manager || lane) return;
  lane = createCaptionLane({
    ...timing,
    cameraIds: new Set(cameraIds),
    fetchImage,
    caption: async (buffer) => {
      const base = await ensureServer();
      try {
        return await captionImage(base, buffer);
      } finally {
        armIdle();
      }
    },
    write: appendRow
  });
  manager.on("event", ({ eventType, data }) => {
    if (eventType !== "state_changed" || !enabled()) return;
    const s = data?.new_state;
    if (s?.entity_id && s.state === "on" && data?.old_state?.state !== "on") lane.noteEdge(s.entity_id);
  });
}
