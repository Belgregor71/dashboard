#!/usr/bin/env node
/**
 * Flag reversibility gate.
 *
 * CLAUDE.md: "Every flag must be cleanly reversible — flipping it off is the
 * rollback path, so verify the off state still passes tests after the flip
 * (flag flips have broken tests that assumed the old default)."
 *
 * That has happened for real: ambientSubstrate going default-on broke two
 * specs that had silently assumed the old default.
 *
 * This is NOT a pre-push gate. It ran there once and cost ~7 minutes of a
 * 7m47s hook, because a *test file* merely mentioning `features.X` pulled X
 * into scope — 7 suite runs, most of them testing nothing. A gate that slow
 * gets bypassed with --no-verify, which disables every other gate too.
 *
 * It lives in the `/flag-flip` skill instead: the moment a flag's default
 * actually changes is when its off state genuinely needs re-proving, and a few
 * minutes is cheap there because it happens rarely and deliberately.
 *
 * History: until 2026-10-03 this refused flags marked `INERT-ON-V3` — flags only
 * the incumbent surface read, whose off state proved nothing about the wall.
 * The incumbent and those flags were deleted together, and
 * tests/flag-surface.spec.js now goes red on any flag V3 does not read, so
 * every flag this script can see is a lever on the wall.
 *
 * Usage:
 *   node scripts/verify/flag-reversibility.mjs --flag <name>   # one flag (flag-flip)
 *   node scripts/verify/flag-reversibility.mjs                 # diff-scoped
 *   node scripts/verify/flag-reversibility.mjs --all           # every ON flag
 *   …--plan-only                      # resolve targets and stop; no build, no suite
 */

import { execFile, execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { promisify } from "util";

// Async on purpose. execFileSync blocks the event loop, which means a queued
// SIGINT handler NEVER RUNS while a build or suite is in flight — verified:
// Ctrl-C mid-run left config.js flipped to false with a TEMPORARILY FLIPPED
// comment still in it. Committed to main, that silently ships a disabled
// feature to the kiosk. Every long-running child below must be awaited.
const run = promisify(execFile);

const CONFIG = "src/js/config.js";
const args = process.argv.slice(2);
const ALL = args.includes("--all");
const ONLY = args.includes("--flag") ? args[args.indexOf("--flag") + 1] : null;
const PLAN_ONLY = args.includes("--plan-only");
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "origin/main";

const sh = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8" }).trim();

/**
 * Every flag and its default.
 *
 * ⚠ Match to end-of-LINE, never `$`: these files are CRLF, so a `$` anchor after
 * an optional comment fails on every flag line that has no comment (the `\r` is
 * neither a space nor a `//`), and the parser silently returns half the flags.
 */
function readFlags() {
  const src = readFileSync(CONFIG, "utf8");
  const start = src.indexOf("features:");
  if (start === -1) throw new Error(`no features block in ${CONFIG}`);
  const flags = {};
  for (const m of src.slice(start).matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*):\s*(true|false),?([^\n]*)/gm)) {
    flags[m[1]] = { on: m[2] === "true" };
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
 * Map a flag to the source that IMPLEMENTS it.
 *
 * Deliberately excludes tests/ and docs/. A spec that pins `features.leanInStack`
 * to exercise a branch is not that flag's implementation, and counting it pulled
 * 7 flags into scope for a diff that changed one CSS rule. Implementation lives
 * in src/ and server/ only.
 */
function filesForFlag(flag) {
  const kebab = flag.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  let refs = [];
  try {
    refs = sh("git", ["grep", "-l", `features.${flag}`, "--", "src", "server"]).split("\n").filter(Boolean);
  } catch {
    /* git grep exits 1 on no match */
  }
  let named = [];
  try {
    named = sh("git", ["ls-files", `src/*${kebab}*`, `server/*${kebab}*`]).split("\n").filter(Boolean);
  } catch {
    /* no match */
  }
  // config.js declares every flag, so a diff touching it would otherwise select
  // all 91. The flag's own default changing is /flag-flip's business, not this.
  return new Set([...refs, ...named].filter((f) => f !== CONFIG));
}

/** Dump the full failing run somewhere readable — the filtered lines above are
 *  a summary, and a reversibility failure usually needs the whole output. */
function outFile(out) {
  try {
    const p = `flag-reversibility-failure.log`;
    writeFileSync(p, out);
    return `\n    (full output: ${p})`;
  } catch {
    return "";
  }
}

const SHELL = process.platform === "win32";

async function runSuite(label) {
  process.stdout.write(`      running suite (${label}) … `);
  try {
    await run("npm", ["test"], { shell: SHELL, maxBuffer: 32 * 1024 * 1024 });
    console.log("pass");
    return { ok: true };
  } catch (e) {
    console.log("FAIL");
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    const lines = out.split("\n");
    // Keep the failing test TITLES, not just the assertion text. Without the
    // spec name a failure here is unactionable — and this repo has at least one
    // known intermittent (the living-accent race), so telling a real
    // reversibility break from a flake depends entirely on naming the test.
    const titles = lines.filter((l) => /^\s*✘|^\s+\d+\)\s|›/.test(l) && !/✓/.test(l));
    const detail = lines.filter((l) => /Error:|expect\(|Received|Expected/.test(l)).slice(0, 8);
    const log = `${outFile(out)}`;
    return { ok: false, output: [...new Set([...titles.slice(0, 10), ...detail])].join("\n") + log };
  }
}

// Self-heal: nothing can restore config.js after a SIGKILL or a power cut, so
// refuse to start on top of a previous run's wreckage. The marker comment makes
// that state unambiguous rather than a mysterious flag sitting at false.
//
// ⚠⚠ SCOPED TO A RUN THAT WILL WRITE — do not widen it back to every run.
// This guard protects the `original` snapshot below: starting on top of a
// marker means restoring TO the wreckage. A --plan-only run takes no snapshot
// and writes nothing, so it has nothing to protect, and aborting it here made
// the tool UNABLE TO COMPLETE FOR ANY FLAG between 7a181c6 and this commit:
// the real run writes the marker, then runs `npm test`, and the suite contains
// tests/flag-reversibility-gate.spec.js, which re-invokes this script
// (--plan-only, always). The inner run read the OUTER run's own marker and
// exited with this message instead of the plan the gate asserts — red in the
// gate spec on every flag, and none of it a reversibility failure of the flag
// being flipped. Regression cover: "a --plan-only run reads a marker-bearing
// config.js instead of aborting" in that same spec.
const onDisk = readFileSync(CONFIG, "utf8");
if (onDisk.includes("TEMPORARILY FLIPPED")) {
  if (!PLAN_ONLY) {
    console.error(
      "[reversibility] config.js still holds a TEMPORARILY FLIPPED flag from an\n" +
        "  interrupted run. Restore it before continuing:\n\n" +
        "    git checkout src/js/config.js && npm run build\n"
    );
    process.exit(1);
  }
  // Say it out loud anyway: a plan resolved from a mutated config.js reads the
  // flipped flag as already-off, and a human running --plan-only by hand should
  // know the plan is not the one a clean tree would give.
  console.log(
    "[reversibility] note: config.js carries a TEMPORARILY FLIPPED marker — an outer\n" +
      "  run is in flight (or was interrupted). --plan-only reads it as-is and writes\n" +
      "  nothing; the flipped flag reads as already-off."
  );
}

const flags = readFlags();

/* A parser that sees nothing approves everything in the same green voice as
   one that checked. config.js carries ~74 flags; a handful means the block or
   the line format moved. */
if (Object.keys(flags).length < 20) {
  console.error(
    `[reversibility] parsed only ${Object.keys(flags).length} flags from ${CONFIG} — the\n` +
      `  features block or the flag line format has moved. Fix the parser first.\n`
  );
  process.exit(1);
}

let targets;
if (ONLY) {
  if (!(ONLY in flags)) {
    console.error(`[reversibility] no such flag: ${ONLY}`);
    process.exit(1);
  }
  if (!flags[ONLY].on) {
    console.log(`[reversibility] ${ONLY} is already false — its off state is what ships`);
    process.exit(0);
  }
  targets = [ONLY];
  console.log(`[reversibility] single flag: ${ONLY}`);
} else if (ALL) {
  targets = Object.keys(flags).filter((f) => flags[f].on);
  console.log(`[reversibility] --all: every ON flag (${targets.length}) — this is slow by design`);
} else {
  const changed = changedFiles();
  targets = Object.keys(flags).filter((flag) => {
    if (!flags[flag].on) return false; // already off; nothing to reverse
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

if (PLAN_ONLY) {
  console.log(`[reversibility] --plan-only: ${targets.length} target(s): ${targets.join(", ")}`);
  process.exit(0);
}

const original = readFileSync(CONFIG, "utf8");
const broken = [];
let restored = false;

/**
 * Put config.js back exactly as found. Idempotent, because it runs from both
 * the finally block and the signal handlers below.
 */
function restore(rebuild = true) {
  if (restored) return;
  restored = true;
  // Synchronous write on purpose: this must complete even inside a signal
  // handler, where there is no chance to await anything.
  writeFileSync(CONFIG, original);
  if (!rebuild) return;
  try {
    execFileSync("npm", ["run", "build"], { stdio: "pipe", shell: SHELL });
  } catch {
    console.error("[reversibility] WARNING: restore build failed — run `npm run build` before pushing");
  }
}

// `finally` does NOT cover signals. Without these, a Ctrl-C (or a SIGPIPE from
// piping this into `head`) leaves config.js with a flag flipped to false and a
// TEMPORARILY FLIPPED comment — which, committed and pushed to main, silently
// deploys a DISABLED feature to the kiosk. Skip the rebuild on the signal path:
// it is slow, and getting the source back is the part that must not be missed.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGPIPE"]) {
  process.on(sig, () => {
    restore(false);
    console.error(`\n[reversibility] ${sig} — config.js restored; run \`npm run build\` before pushing`);
    process.exit(130);
  });
}
process.on("uncaughtException", (err) => {
  restore(false);
  console.error(`\n[reversibility] crashed — config.js restored: ${err.message}`);
  process.exit(1);
});

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

    await run("npm", ["run", "build"], { shell: SHELL, maxBuffer: 32 * 1024 * 1024 });
    const res = await runSuite(`${flag}=false`);
    if (!res.ok) broken.push({ flag, why: `suite fails with ${flag} off`, detail: res.output });
  }
} finally {
  restore();
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
