#!/usr/bin/env node
/**
 * Regenerate the agent-facing mirror from the Claude Code originals:
 *
 *     .claude/skills/**  ->  .agents/skills/**
 *     CLAUDE.md          ->  AGENTS.md
 *
 * Both sides are gitignored on purpose (.gitignore:13-24): the originals are
 * ignored, so tracking the copy would make the COPY canonical and let it drift
 * unwatched. This script exists because that mirror was previously produced by
 * a one-off external generator with no checked-in source — and it had already
 * drifted two days in (docs/BACKLOG.md P4). Run it after editing CLAUDE.md or
 * anything under .claude/skills/.
 *
 *   node scripts/mirror-agents.mjs           rewrite the mirror
 *   node scripts/mirror-agents.mjs --check   verify only; exit 1 on drift
 *
 * ── The two substitutions ───────────────────────────────────────────────────
 *   CLAUDE.md  -> AGENTS.md      (5 occurrences today: the skills cite the
 *                                 house rules BY SECTION NAME, so a mirror that
 *                                 skipped this would cite a file the agent
 *                                 reading it cannot see)
 *   .claude/   -> .agents/       (repo-relative paths only — see the guard)
 *
 * ── Why `.claude/` is NOT a blanket replace ─────────────────────────────────
 * A naive s/.claude/.agents/ CORRUPTS working code. In install.sh alone it
 * would rewrite an external download URL
 *   (raw.githubusercontent.com/nexu-io/open-design/main/.claude/skills/...)
 * and the user's own global Claude Code install path ($HOME/.claude/skills/),
 * neither of which has anything to do with this repo's mirror. So the replace
 * is guarded by a lookbehind: a `.claude/` preceded by `~`, `/`, or a word/`$`
 * character is somebody else's path and is left alone. That is the same class
 * of mistake the previous generator shipped (its s/.claude/.Codex/ was wrong
 * twice), which is the whole reason this file is checked in.
 *
 * ── VERBATIM skills ─────────────────────────────────────────────────────────
 * `od-contribute` is vendored from an upstream project. Every `.claude/` inside
 * it refers to that project or to the user's home directory, and none of it
 * describes this repo — so it is copied byte-for-byte with no substitution at
 * all. Add any future vendored skill to VERBATIM.
 *
 * ── Out of scope ────────────────────────────────────────────────────────────
 * `.codex/` is NOT managed here. Its hooks.json is a FORMAT CONVERSION of
 * .claude/settings.json, not a text mirror, and .claude/settings*.json holds
 * local machine state that must not be copied anywhere. Left to a human.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, copyFileSync, existsSync, rmdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_SKILLS = join(REPO, ".claude", "skills");
const DST_SKILLS = join(REPO, ".agents", "skills");
const SRC_DOC = join(REPO, "CLAUDE.md");
const DST_DOC = join(REPO, "AGENTS.md");

/** Vendored skills: copied byte-for-byte, never substituted. */
const VERBATIM = new Set(["od-contribute"]);

const CHECK = process.argv.includes("--check");

/**
 * The `.claude/` guard. Only a repo-relative reference is rewritten; anything
 * reached through `~`, `$HOME`, a URL, or an interpolated root belongs to
 * someone else. The lookbehind rejects the character immediately before it.
 */
const CLAUDE_DIR_RE = /(?<![~\w$}/])\.claude\//g;

function transform(text) {
  return text.replace(/CLAUDE\.md/g, "AGENTS.md").replace(CLAUDE_DIR_RE, ".agents/");
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const drift = [];
let written = 0;
let verbatim = 0;

/** Write `bytes` to `dst` unless it already matches. Records drift in --check. */
function emit(dst, bytes, label) {
  const current = existsSync(dst) ? readFileSync(dst) : null;
  if (current && current.equals(bytes)) return false;
  drift.push(`${current ? "stale" : "missing"}: ${relative(REPO, dst)}${label}`);
  if (!CHECK) {
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, bytes);
  }
  written++;
  return true;
}

// ── CLAUDE.md -> AGENTS.md ───────────────────────────────────────────────────
if (!existsSync(SRC_DOC)) {
  console.error("[mirror] ABORT: CLAUDE.md not found — wrong working directory?");
  process.exit(2);
}
emit(DST_DOC, Buffer.from(transform(readFileSync(SRC_DOC, "utf8")), "utf8"), "");

// ── .claude/skills -> .agents/skills ─────────────────────────────────────────
const sources = walk(SRC_SKILLS);
if (sources.length === 0) {
  console.error(`[mirror] ABORT: no files under ${relative(REPO, SRC_SKILLS)} — refusing to`);
  console.error("         prune the mirror against an empty source tree.");
  process.exit(2);
}

const expected = new Set([DST_DOC]);
for (const src of sources) {
  const rel = relative(SRC_SKILLS, src);
  const dst = join(DST_SKILLS, rel);
  expected.add(dst);

  const skill = rel.split(sep)[0];
  const raw = readFileSync(src);

  if (VERBATIM.has(skill)) {
    verbatim++;
    if (emit(dst, raw, "  (verbatim)") && !CHECK) copyFileSync(src, dst);
    continue;
  }

  // Non-UTF8 payloads are copied through untouched rather than mangled.
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    emit(dst, raw, "  (binary)");
    continue;
  }
  emit(dst, Buffer.from(transform(text), "utf8"), "");
}

// ── Prune anything the source no longer has ──────────────────────────────────
const orphans = walk(DST_SKILLS).filter((f) => !expected.has(f));
for (const orphan of orphans) {
  drift.push(`orphan: ${relative(REPO, orphan)}`);
  if (!CHECK) rmSync(orphan);
}
if (!CHECK) {
  // Sweep directories the prune emptied, deepest first.
  for (const dir of walk(DST_SKILLS, []).map(dirname).concat([DST_SKILLS]).sort((a, b) => b.length - a.length)) {
    try { if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir); } catch { /* not empty */ }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (CHECK) {
  if (drift.length === 0) {
    console.log(`[mirror] up to date (${sources.length + 1} files, ${verbatim} verbatim).`);
    process.exit(0);
  }
  console.error(`[mirror] OUT OF DATE — ${drift.length} file(s):`);
  for (const d of drift) console.error(`           ${d}`);
  console.error("\n           Fix: node scripts/mirror-agents.mjs");
  process.exit(1);
}

console.log(`[mirror] ${sources.length + 1} source files -> .agents/ (${verbatim} verbatim, ${orphans.length} pruned)`);
console.log(written ? `[mirror] rewrote ${written} file(s).` : "[mirror] already up to date, nothing written.");
console.log("[mirror] note: .codex/ is NOT managed by this script (format conversion, by hand).");
