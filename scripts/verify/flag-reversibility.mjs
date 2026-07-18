#!/usr/bin/env node
/**
 * Flag reversibility gate.
 *
 * CLAUDE.md: "Every flag must be cleanly reversible — flipping it off is the
 * rollback path, so verify the off state still passes tests after the flip
 * (flag flips have broken tests that assumed the old default)."
 *
 * That has happened for real: ambientSubstrate going default-on broke
 * presence.spec:79 and ui.spec:39, which had silently assumed the old default.
 *
 * Scope: only flags whose implementation the outgoing diff actually touches.
 * A full 39-flag matrix is ~39 suite runs — over an hour, which would mean
 * everyone bypasses the hook. Diff-scoped is usually 0-2 runs and catches the
 * case that actually bites: you changed a flagged feature, and its OFF path
 * (the rollback you'd reach for at 11pm when the kiosk is wrong) is broken.
 *
 * Usage: node scripts/verify/flag-reversibility.mjs [--all] [--base <ref>]
 */

import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const CONFIG = "src/js/config.js";
const args = process.argv.slice(2);
const ALL = args.includes("--all");
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "origin/main";

const sh = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8" }).trim();

function readFlags() {
  const src = readFileSync(CONFIG, "utf8");
  const start = src.indexOf("features:");
  if (start === -1) throw new Error(`no features block in ${CONFIG}`);
  const flags = {};
  for (const m of src.slice(start).matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*):\s*(true|false),/gm)) {
    flags[m[1]] = m[2] === "true";
  }
  return flags;
}

/** Files the outgoing push changes, relative to the push base. */
function changedFiles() {
  let base = BASE;
  try {
    sh("git", ["rev-parse", "--verify", base]);
  } catch {
    // No upstream yet (fresh branch) — fall back to the merge-base with main.
    base = sh("git", ["merge-base", "HEAD", "main"]);
  }
  return sh("git", ["diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
}

/**
 * Map a flag to the source that implements it. Two signals, both cheap:
 *   1. files that reference `features.<flag>` (the runtime gate)
 *   2. files/specs named after the flag in kebab-case (the convention here:
 *      leanInStack -> lean-in-stack.spec.js, ambientClock -> ambient-clock.css)
 */
function filesForFlag(flag) {
  const kebab = flag.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  let refs = [];
  try {
    refs = sh("git", ["grep", "-l", `features.${flag}`, "--", "src", "tests"]).split("\n").filter(Boolean);
  } catch {
    /* git grep exits 1 on no match */
  }
  let named = [];
  try {
    named = sh("git", ["ls-files", `*${kebab}*`]).split("\n").filter(Boolean);
  } catch {
    /* no match */
  }
  return new Set([...refs, ...named]);
}

function runSuite(label) {
  process.stdout.write(`      running suite (${label}) … `);
  try {
    execFileSync("npm", ["test"], { stdio: "pipe", shell: process.platform === "win32" });
    console.log("pass");
    return { ok: true };
  } catch (e) {
    console.log("FAIL");
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    return { ok: false, output: out.split("\n").filter((l) => /✘|failed|Error:/.test(l)).slice(0, 12).join("\n") };
  }
}

const flags = readFlags();
const changed = changedFiles();

let targets;
if (ALL) {
  targets = Object.keys(flags).filter((f) => flags[f]);
  console.log(`[reversibility] --all: every ON flag (${targets.length}) — this is slow by design`);
} else {
  targets = Object.keys(flags).filter((flag) => {
    if (!flags[flag]) return false; // already off; nothing to reverse
    const owned = filesForFlag(flag);
    return changed.some((f) => owned.has(f));
  });
  console.log(
    `[reversibility] ${changed.length} changed file(s) → ${targets.length} flag(s) in scope` +
      (targets.length ? `: ${targets.join(", ")}` : "")
  );
}

if (!targets.length) {
  console.log("[reversibility] nothing to verify — no ON flag's implementation was touched");
  process.exit(0);
}

const original = readFileSync(CONFIG, "utf8");
const broken = [];

try {
  for (const flag of targets) {
    console.log(`  [reversibility] ${flag}: true → false`);
    const flipped = original.replace(
      new RegExp(`^(\\s{4}${flag}:\\s*)true,`, "m"),
      "$1false, // TEMPORARILY FLIPPED BY flag-reversibility.mjs"
    );
    if (flipped === original) {
      broken.push({ flag, why: "could not rewrite the flag — regex did not match" });
      continue;
    }
    writeFileSync(CONFIG, flipped);

    execFileSync("npm", ["run", "build"], { stdio: "pipe", shell: process.platform === "win32" });
    const res = runSuite(`${flag}=false`);
    if (!res.ok) broken.push({ flag, why: `suite fails with ${flag} off`, detail: res.output });
  }
} finally {
  // Always restore, including on Ctrl-C paths — a half-flipped config.js is
  // exactly the kind of thing that would get committed by accident.
  writeFileSync(CONFIG, original);
  try {
    execFileSync("npm", ["run", "build"], { stdio: "pipe", shell: process.platform === "win32" });
  } catch {
    console.error("[reversibility] WARNING: restore build failed — run `npm run build` before pushing");
  }
}

if (broken.length) {
  console.error("\n[reversibility] FAIL — these flags are not cleanly reversible:\n");
  for (const b of broken) {
    console.error(`  ${b.flag}: ${b.why}`);
    if (b.detail) console.error(b.detail.replace(/^/gm, "    "));
  }
  console.error(
    "\n  The off state is the rollback path. A flag that cannot be flipped off\n" +
      "  is a change you cannot undo on the kiosk without a revert commit.\n"
  );
  process.exit(1);
}

console.log(`[reversibility] pass — ${targets.length} flag(s) cleanly reversible`);
