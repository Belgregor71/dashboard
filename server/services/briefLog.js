/* What the briefing was told, what the model said, and what the house let through.

   12 Nov: the wall said pizza on soup night and nothing on the box could say what
   the prompt or the words had been. This is that record. It names the family, so
   it lives in gitignored data/ and never leaves the box. */

import { readFile, writeFile, appendFile, mkdir, rename } from "fs/promises";
import path from "path";

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
export const FILE = path.resolve("data", "brief-log.jsonl");

/** Rows inside retention. A torn or foreign line is dropped, not fatal. */
export function prune(text, now = Date.now()) {
  return String(text).split("\n").filter((line) => {
    try { return JSON.parse(line).at > now - RETENTION_MS; } catch { return false; }
  });
}

let lastPrune = 0;
let tail = Promise.resolve();

/** Append one row. Never throws: a full disk must not cost the house its briefing. */
export function logBrief(row, { file = process.env.BRIEF_LOG_FILE ?? FILE, now = Date.now() } = {}) {
  const write = async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify({ at: now, ...row }) + "\n", "utf8");
    if (now - lastPrune < PRUNE_EVERY_MS) return;
    lastPrune = now;
    const kept = prune(await readFile(file, "utf8"), now);
    await writeFile(`${file}.tmp`, kept.join("\n") + "\n", "utf8");
    await rename(`${file}.tmp`, file);
  };
  const warn = (err) => console.warn("[brief-log] not written:", err.message);
  tail = tail.then(write).catch(warn);
  return tail;
}
