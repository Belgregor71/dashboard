/* ═══════════════════════════════════════════════════════════════════════════
   THE CAST — two voices, preloaded.

   The script and its audio live in data/cast/, gitignored: the repo is public
   and neither belongs in it. This file is mechanism only.

     data/cast/lines.json    { exchanges: [{ id, event, floor?, lines: [
                               { speaker, text, plain? } ] }] }
     data/cast/clips/        <exchange id>-<line index>.wav
     data/cast/vetoes.json   ids the owner never wants to hear again

   Selection happens here rather than in the page so no copy reaches the bundle.

   An exchange that cannot be played correctly is never offered:
     · an unknown person at a door must open with a line marked `plain`. The
       alert is information first, and a gag may only follow it.
     · a missing clip would leave a hole in the middle of a two-hander.
   ═══════════════════════════════════════════════════════════════════════════ */

import express from "express";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loopbackOnly } from "../middleware/security.js";

const SPEAKERS = new Set(["kath", "kim"]);
const CLIP_RE = /^[a-z0-9-]+\.wav$/;
const UNKNOWN_DOOR_RE = /^door:[a-z_]+:unknown$/;

/* Read per call, not at module load: server.js imports this route before it
   calls dotenv.config(). */
const castDir = () => process.env.CAST_DIR || path.resolve("data/cast");
export const castEnabled = () => process.env.HOUSE_CAST_ENABLED === "1";

export const clipName = (id, index) => `${id}-${index}.wav`;

/** Why this exchange cannot be offered, or null. `hasClip` is a seam for specs. */
export function exchangeFault(exchange, hasClip) {
  const lines = exchange?.lines;
  if (!exchange?.id || !exchange?.event || !Array.isArray(lines) || lines.length === 0) return "shape";
  if (lines.some((line) => !SPEAKERS.has(line.speaker) || !line.text)) return "speaker";
  if (UNKNOWN_DOOR_RE.test(exchange.event) && !lines[0].plain) return "not plain first";
  if (lines.some((_, index) => !hasClip(clipName(exchange.id, index)))) return "clip missing";
  return null;
}

let cached = { mtimeMs: 0, exchanges: [] };

function loadExchanges() {
  const file = path.join(castDir(), "lines.json");
  let mtimeMs;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return [];
  }
  if (mtimeMs === cached.mtimeMs) return cached.exchanges;

  const hasClip = (name) => existsSync(path.join(castDir(), "clips", name));
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`[cast] lines.json unreadable: ${err.message}`);
    return cached.exchanges;
  }
  const exchanges = (parsed.exchanges ?? []).filter((exchange) => {
    const fault = exchangeFault(exchange, hasClip);
    if (fault) console.warn(`[cast] dropped ${exchange?.id ?? "?"}: ${fault}`);
    return !fault;
  });
  cached = { mtimeMs, exchanges };
  return exchanges;
}

function readVetoes() {
  try {
    return new Set(JSON.parse(readFileSync(path.join(castDir(), "vetoes.json"), "utf8")));
  } catch {
    return new Set();
  }
}

/** Offerable now: a veto removes a line, but a floor line can never be vetoed,
 *  so the owner cannot silence a door by accident. */
export function poolFor(exchanges, event, vetoes) {
  return exchanges.filter((exchange) => exchange.event === event && (exchange.floor || !vetoes.has(exchange.id)));
}

/* Every line once before any line twice, per event. In memory: a restart just
   starts a new bag, which nobody can hear. */
const bags = new Map();
const lastByEvent = new Map();
let lastPlayed = null;

export function drawFrom(pool, event, random = Math.random) {
  const ids = new Set(pool.map((exchange) => exchange.id));
  let bag = (bags.get(event) ?? []).filter((id) => ids.has(id));
  if (bag.length === 0) {
    bag = [...ids];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // Drawn from the end, so the refill seam cannot repeat a line either.
    if (bag.length > 1 && bag[bag.length - 1] === lastByEvent.get(event)) {
      [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
  }
  const id = bag.pop();
  bags.set(event, bag);
  lastByEvent.set(event, id);
  return pool.find((exchange) => exchange.id === id);
}

/* ── Live voices ─────────────────────────────────────────────────────────────
   The clones run on the PC, which sleeps. Probed in the background so a line
   asked for while it is off gets its excuse at once rather than after a
   timeout, and started on first use so a house without the cast never polls. */
const PROBE_MS = 15_000;
const PROBE_TIMEOUT_MS = 2_500;
let live = false;
let firstProbe = null;

async function probe() {
  try {
    const url = process.env.KOKORO_URL ?? "http://localhost:8880";
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    live = res.ok && (await res.json()).cast === true;
  } catch {
    live = false;
  }
}

/** The private persona block, or "" when there is none. */
export function castPersona() {
  try {
    return readFileSync(path.join(castDir(), "persona.txt"), "utf8").trim();
  } catch {
    return "";
  }
}

/** An AI lane speaks as the cast only when the page asks and the server can. */
export const castActive = (asked) => asked === true && castEnabled() && Boolean(castPersona());

/** The voice to synthesise with, or null for the ordinary house voice. */
export function castVoiceFor(voice) {
  return castEnabled() && SPEAKERS.has(voice) ? voice : null;
}

/** Only the very first ask waits, or a fresh server would excuse a working PC. */
export async function castLive() {
  if (!firstProbe) {
    firstProbe = probe();
    setInterval(probe, PROBE_MS).unref();
  }
  await firstProbe;
  return live;
}

/** What to play instead of a live line, as clip urls. A speaker with its own
 *  pool keeps its fact: a door or a timer is never just an excuse. */
export function excuseClips(author) {
  const vetoes = readVetoes();
  const exchanges = loadExchanges();
  const own = poolFor(exchanges, `excuse:${author}`, vetoes);
  const event = own.length ? `excuse:${author}` : "excuse:live";
  const pool = own.length ? own : poolFor(exchanges, event, vetoes);
  if (pool.length === 0) return [];
  const exchange = drawFrom(pool, event);
  return exchange.lines.map((_, index) => `/api/cast/clip/${clipName(exchange.id, index)}`);
}

/** Test seam. */
export function __resetBags() {
  bags.clear();
  lastByEvent.clear();
  lastPlayed = null;
}

const router = express.Router();

router.get("/api/cast/state", loopbackOnly("The cast"), (_req, res) => {
  res.json({ enabled: castEnabled(), exchanges: castEnabled() ? loadExchanges().length : 0 });
});

/** `old words => new words`, one a line, into a map. Pure. */
export function parseWall(text) {
  const lines = {};
  for (const raw of text.split(/\r?\n/)) {
    const [from, to] = raw.split(" => ");
    if (from?.trim() && to?.trim()) lines[from.trim()] = to.trim();
  }
  return lines;
}

router.get("/api/cast/wall", loopbackOnly("The cast"), (_req, res) => {
  if (!castEnabled()) { res.json({ lines: {} }); return; }
  try {
    res.json({ lines: parseWall(readFileSync(path.join(castDir(), "wall.txt"), "utf8")) });
  } catch {
    res.json({ lines: {} });
  }
});

router.post("/api/cast/pick", loopbackOnly("The cast"), (req, res) => {
  const event = req.body?.event;
  if (typeof event !== "string" || !event) { res.status(400).json({ error: "event is required" }); return; }
  if (!castEnabled()) { res.json({ exchange: null }); return; }

  const pool = poolFor(loadExchanges(), event, readVetoes());
  if (pool.length === 0) { res.json({ exchange: null }); return; }

  const exchange = drawFrom(pool, event);
  lastPlayed = exchange;
  res.json({
    exchange: {
      id: exchange.id,
      clips: exchange.lines.map((_, index) => `/api/cast/clip/${clipName(exchange.id, index)}`)
    }
  });
});

router.get("/api/cast/clip/:file", loopbackOnly("The cast"), (req, res) => {
  const { file } = req.params;
  if (!CLIP_RE.test(file)) { res.status(400).json({ error: "bad clip name" }); return; }
  res.sendFile(path.join(castDir(), "clips", file), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "no such clip" });
  });
});

/* The owner reviews by ear, on the wall, so removing a line must be instant and
   must not need a deploy. No id means "the one you just heard". */
router.post("/api/cast/veto", loopbackOnly("The cast"), (req, res) => {
  const target = req.body?.id
    ? loadExchanges().find((exchange) => exchange.id === req.body.id)
    : lastPlayed;
  if (!target) { res.status(404).json({ error: "nothing to veto" }); return; }
  if (target.floor) { res.status(409).json({ error: "a floor line cannot be vetoed", id: target.id }); return; }

  const vetoes = readVetoes();
  vetoes.add(target.id);
  writeFileSync(path.join(castDir(), "vetoes.json"), JSON.stringify([...vetoes], null, 2));
  res.json({ vetoed: target.id });
});

export default router;
