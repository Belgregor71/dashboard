#!/usr/bin/env node
/* Compile data/cast/script.txt into lines.json, then render clips through the
   PC's speech server, which hands kath and kim to VoiceStudio. Only new or
   changed lines are rendered.

     node scripts/cast-generate.mjs           render
     node scripts/cast-generate.mjs --push    render, then copy to the G11

   The script is blocks separated by blank lines:

     == line:Timer's done.          the event every block below it belongs to
     [floor]                        optional: this block can never be vetoed
     kath! Someone's at the door.   ! marks a plain statement of fact
     kim: I've just done me nails.

   A block's id comes from its words, so a veto stays on that exact exchange and
   editing a line makes it a new one.

   Clips go first on a push: the server re-reads lines.json when its mtime moves,
   and an exchange whose clip has not landed yet would be dropped as incomplete. */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPEECH_URL = process.env.CAST_SPEECH_URL || "http://127.0.0.1:8880/v1/audio/speech";
const DIR = process.env.CAST_DIR || path.resolve("data/cast");
const REMOTE_HOST = "pi-dashboard";
const REMOTE_DIR = "/home/dashboard/dashboard/data/cast";
const MIN_SECONDS = 0.3;
const MIN_RMS = 200; // 16-bit: below this a clip is silence with a little noise
const ATTEMPTS = 2;
/* Matches createSpeech's default in tts.js: a clip faster than the live lines beside it reads as rushed. */
const SPEED = 0.92;

/** The script's text as exchanges. Throws on a line it cannot read: a typo must
 *  stop the render, not quietly lose a line. */
export function parseScript(text) {
  const exchanges = [];
  let event = null;
  let block = null;
  const finish = () => {
    if (block?.lines.length) {
      const words = block.lines.map((l) => `${l.speaker}:${l.text}`).join("|");
      const slug = event.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().replace(/^-|-$/g, "").slice(0, 28).replace(/-$/, "");
      const id = `${slug}-${createHash("sha256").update(`${event}|${words}`).digest("hex").slice(0, 6)}`;
      if (exchanges.some((x) => x.id === id)) throw new Error(`duplicate exchange: ${words}`);
      exchanges.push({ id, event, ...(block.floor ? { floor: true } : {}), lines: block.lines });
    }
    block = null;
  };

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    if (!line) { finish(); continue; }
    if (line.startsWith("==")) { finish(); event = line.slice(2).trim(); continue; }
    if (!event) throw new Error(`line ${index + 1}: no event yet`);
    block ??= { floor: false, lines: [] };
    if (line === "[floor]") { block.floor = true; continue; }
    const match = /^(kath|kim)(!|:)\s*(.+)$/.exec(line);
    if (!match) throw new Error(`line ${index + 1}: cannot read "${line}"`);
    block.lines.push({ speaker: match[1], text: match[3], ...(match[2] === "!" ? { plain: true } : {}) });
  }
  finish();
  return exchanges;
}

/** Seconds and loudness of a 16-bit mono WAV, or null when it is not one. */
export function wavStats(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  const rate = buf.readUInt32LE(24);
  const data = buf.indexOf("data", 12);
  if (data < 0 || !rate) return null;
  const pcm = buf.subarray(data + 8);
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return { seconds: 0, rms: 0 };
  let sum = 0;
  for (let i = 0; i < samples; i++) sum += pcm.readInt16LE(i * 2) ** 2;
  return { seconds: samples / rate, rms: Math.sqrt(sum / samples) };
}

/** Why this clip must not ship, or null. A wildly long clip is a model that ran on. */
export function clipFault(stats, text) {
  if (!stats) return "not a wav";
  if (stats.seconds < MIN_SECONDS) return "too short";
  if (stats.rms < MIN_RMS) return "silent";
  if (stats.seconds > text.length * 0.2 + 4) return "too long";
  return null;
}

async function render(voice, text) {
  const res = await fetch(SPEECH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "kokoro", input: text, voice, response_format: "wav", speed: SPEED }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${cmd} failed with ${result.status}`);
}

async function main() {
  const clips = path.join(DIR, "clips");
  mkdirSync(clips, { recursive: true });
  const manifestFile = path.join(DIR, "manifest.json");
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : {};
  const exchanges = parseScript(readFileSync(path.join(DIR, "script.txt"), "utf8"));
  writeFileSync(path.join(DIR, "lines.json"), JSON.stringify({ exchanges }, null, 2));
  console.log(`[cast] ${exchanges.length} exchanges, ${exchanges.reduce((n, x) => n + x.lines.length, 0)} lines`);

  let rendered = 0;
  const failed = [];
  for (const exchange of exchanges) {
    for (const [index, line] of exchange.lines.entries()) {
      const name = `${exchange.id}-${index}.wav`;
      const hash = createHash("sha256").update(`${line.speaker}::${line.text}::${SPEED}`).digest("hex");
      if (manifest[name] === hash && existsSync(path.join(clips, name))) continue;

      let fault = null;
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
          const wav = await render(line.speaker, line.text);
          fault = clipFault(wavStats(wav), line.text);
          if (fault) continue;
          writeFileSync(path.join(clips, name), wav);
          manifest[name] = hash;
          rendered += 1;
          break;
        } catch (err) {
          fault = err.message;
        }
      }
      if (fault) failed.push(`${name}: ${fault}`);
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    }
  }

  console.log(`[cast] rendered ${rendered}, failed ${failed.length}`);
  for (const line of failed) console.log(`  ${line}`);

  if (process.argv.includes("--push")) {
    if (failed.length) throw new Error("not pushing with failed clips");
    run("ssh", [REMOTE_HOST, `mkdir -p ${REMOTE_DIR}/clips`]);
    // scp, not rsync: this box has none. The whole folder each time, a few MB.
    run("scp", ["-q", "-r", clips, `${REMOTE_HOST}:${REMOTE_DIR}/`]);
    run("scp", ["-q", path.join(DIR, "lines.json"), `${REMOTE_HOST}:${REMOTE_DIR}/lines.json`]);
    console.log("[cast] pushed");
  }
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[cast] ${err.message}`);
    process.exit(1);
  });
}
