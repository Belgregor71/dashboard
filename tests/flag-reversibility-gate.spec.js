import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* ═══════════════════════════════════════════════════════════════════════════
   /flag-flip MUST REFUSE AN INERT-ON-V3 FLAG.

   CLAUDE.md, Feature Flags: "A flag marked INERT-ON-V3 is not a lever on the
   wall. No module V3 loads reads it, so flipping it off changes nothing on `/`
   and is not a rollback — the flag-off half of /flag-flip passes while proving
   nothing."

   `scripts/verify/flag-reversibility.mjs` is the flag-off half. Until now it
   would happily flip a marked flag to false, watch the suite stay green, and
   print `pass — 1 flag(s) cleanly reversible` — a sentence /flag-flip step 7 is
   told to report as the evidence that the rollback works. The green came from
   the INCUMBENT surface; the wall was never involved.

   This spec holds the refusal, in both directions, because half a test is how
   this one ships broken:

     · a marked flag is REFUSED, and the refusal names the lever that does work
     · an unmarked flag is NOT refused — otherwise a gate that refuses
       everything passes the first assertion and blocks every real flip
     · nothing is written to config.js on the refusing path

   Every flag name is DERIVED from config.js, never hardcoded: a spec pinned to
   `plex` goes vacuously green the day that mark moves. The marks themselves are
   checked against V3's import closure by tests/flag-surface.spec.js — this spec
   checks only that the gate obeys them.

   ⚠⚠ `gate()` BELOW FORCES --plan-only ON EVERY RUN, AND MUST KEEP DOING SO.
   The script's job when it is not refusing is to rewrite config.js, build, and
   run `npm test`. Reached from inside a spec, that is `npm test` recursing into
   itself with config.js mutated — measured 2026-09-19 while injecting the
   defect for this very spec: the suite ran for five minutes inside itself, and
   the outer kill left `background: false, // TEMPORARILY FLIPPED` in the built
   `static/js/config.js` (the signal handler restores the SOURCE and skips the
   rebuild). A refusal is asserted THROUGH --plan-only, not instead of it: the
   refusal exits before plan resolution, so a gate that stops refusing exits 0
   with a plan instead of 1 with a reason, and these tests go red either way.
   ═══════════════════════════════════════════════════════════════════════════ */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(root, "src", "js", "config.js");
const GATE = join("scripts", "verify", "flag-reversibility.mjs");
const MARK = "INERT-ON-V3";

/**
 * Run the gate; never throws, so a refusal's exit code is an assertable value.
 *
 * ⚠ --plan-only is appended HERE rather than at each call site, so no future
 * test in this file can forget it and recurse into `npm test`. See the header.
 */
function gate(...args) {
  try {
    const stdout = execFileSync(process.execPath, [GATE, ...args, "--plan-only"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** The same three facts the gate reads, parsed independently of it. */
function flags() {
  const src = readFileSync(CONFIG, "utf8");
  const start = src.indexOf("features:");
  const out = [];
  for (const m of src.slice(start).matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*):\s*(true|false),?([^\n]*)/gm)) {
    const comment = (m[3].match(/\/\/(.*)/) || ["", ""])[1];
    out.push({
      name: m[1],
      on: m[2] === "true",
      inert: comment.includes(MARK),
      lever: (comment.match(/V3 lever:\s*`?(\w+)`?/) || [])[1] || null
    });
  }
  return out;
}

/**
 * Run the gate against a THROWAWAY COPY of config.js, in a throwaway cwd.
 *
 * The script resolves `src/js/config.js` relative to its cwd, so a fixture dir
 * holding one file is a whole alternate repo as far as it is concerned — which
 * is the only way to test its behaviour on a config.js state the real tree must
 * never be put into.
 *
 * ⚠ This is the ONE runner in this file that does not force --plan-only, so
 * every caller owes a reason the write path is unreachable for its fixture —
 * see each test. `mutate` must change something: a fixture whose regex silently
 * missed is a test that proves nothing, which is the failure mode this whole
 * file exists to avoid.
 */
function inFixture(mutate, args) {
  const src = readFileSync(CONFIG, "utf8");
  const config = mutate(src);
  if (config === src) throw new Error("fixture mutation changed nothing — the test below would prove nothing");

  const dir = mkdtempSync(join(tmpdir(), "flag-rev-"));
  try {
    mkdirSync(join(dir, "src", "js"), { recursive: true });
    writeFileSync(join(dir, "src", "js", "config.js"), config);
    try {
      const stdout = execFileSync(process.execPath, [join(root, GATE), ...args], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000
      });
      return { code: 0, out: stdout, config };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}`, config };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MARKER = "TEMPORARILY FLIPPED";

test.describe("flag reversibility gate — INERT-ON-V3 is refused", () => {
  test("config.js still offers both cases to test", () => {
    /* Assert the fixtures are there before asserting anything about them. If
       config.js ever holds no marked flag, or no unmarked ON flag, the tests
       below would skip their subject and go green having run nothing. */
    const f = flags();
    expect(f.length, "no flags parsed out of config.js").toBeGreaterThan(40);
    expect(f.filter((x) => x.inert).length, `no flag carries ${MARK}`).toBeGreaterThan(0);
    expect(f.filter((x) => x.inert && x.lever).length, "no marked flag names a V3 lever").toBeGreaterThan(0);
    expect(f.filter((x) => !x.inert && x.on).length, "no unmarked ON flag — no positive control").toBeGreaterThan(0);
  });

  test("a marked flag is refused, and the refusal names the lever", () => {
    const target = flags().find((f) => f.inert && f.lever && f.on);
    const r = gate("--flag", target.name);

    expect(r.code, `${target.name} is ${MARK} but the gate ran it anyway`).toBe(1);
    expect(r.out).toContain("REFUSED");
    expect(r.out).toContain(target.name);
    expect(r.out).toContain(MARK);
    /* The lever is the part that matters. A refusal that only says "no" leaves
       the session to guess which flag to flip, and the guess is the whole
       defect arriving one step later. */
    expect(r.out, `the refusal does not name the V3 lever (${target.lever})`).toContain(target.lever);
    /* And it must say how to mean it on purpose, or the gate is unbypassable
       for the Pi 4 rollback host, which serves the incumbent. */
    expect(r.out).toContain("--incumbent-only");
  });

  test("a marked flag with no lever is refused too, and says there is none", () => {
    const target = flags().find((f) => f.inert && !f.lever && f.on);
    test.skip(!target, "no marked ON flag without a named lever");
    const r = gate("--flag", target.name);
    expect(r.code).toBe(1);
    expect(r.out).toContain("REFUSED");
    expect(r.out).toMatch(/no lever|names no V3 lever/);
  });

  test("the refusal comes before anything is written", () => {
    /* The flip loop rewrites config.js and restores it in a `finally`; a
       refusal that happened after it would pass every assertion above and still
       leave the window where an interrupted run strands the kiosk's config.
       --plan-only exits before the first write, so a refusal that beats
       --plan-only beats the write — and config.js is compared either way,
       because "it exited early" is a claim about the file, not the output. */
    const target = flags().find((f) => f.inert && f.on);
    const before = readFileSync(CONFIG, "utf8");
    const r = gate("--flag", target.name);
    expect(r.code).toBe(1);
    expect(r.out).toContain("REFUSED");
    expect(r.out, "the gate resolved a plan before refusing").not.toContain("target(s)");
    expect(readFileSync(CONFIG, "utf8"), "config.js was rewritten on the refusing path").toBe(before);
  });

  test("a flag V3 reads is NOT refused", () => {
    /* The positive control. Without it, a gate that refuses every flag — or one
       whose mark test is inverted — passes everything above while blocking the
       flips /flag-flip exists to run. */
    const target = flags().find((f) => !f.inert && f.on);
    const r = gate("--flag", target.name);

    expect(r.code, `${target.name} is read by V3 but the gate refused it:\n${r.out}`).toBe(0);
    expect(r.out).not.toContain("REFUSED");
    expect(r.out).toContain(`single flag: ${target.name}`);
    expect(r.out).toContain(`1 target(s): ${target.name}`);
  });

  test("--incumbent-only proceeds, and says what it does not prove", () => {
    const target = flags().find((f) => f.inert && f.on);
    const r = gate("--flag", target.name, "--incumbent-only");

    expect(r.code).toBe(0);
    expect(r.out).not.toContain("REFUSED");
    expect(r.out).toContain(`1 target(s): ${target.name}`);
    /* An override that goes quiet is worse than no override: the run's output
       is what gets pasted into the session report as proof. */
    expect(r.out).toMatch(/NOT a rollback proof for the wall/);
  });

  test("the bulk lane labels its marked flags instead of overclaiming", () => {
    /* --all and the diff-scoped lane are not /flag-flip, so they run marked
       flags — the incumbent still ships. What they must not do is let a line of
       their output read as a rollback proof for a flag with no lever. */
    const r = gate("--all");
    const marked = flags().filter((f) => f.inert && f.on);

    expect(r.code).toBe(0);
    expect(r.out).toContain(`${marked.length} of these are ${MARK}`);
    expect(r.out).toContain("not a wall rollback proof");
    expect(r.out).toContain(marked[0].name);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE GATE SPEC RUNS INSIDE THE THING IT TESTS.

   A real `--flag X` run writes `false, // TEMPORARILY FLIPPED BY …` into
   config.js and then runs `npm test` to prove the off state passes. That suite
   contains THIS FILE, which spawns the gate again. So every assertion above is
   made while config.js carries the outer run's own marker.

   Between 7a181c6 and the fix below, the script's start-up self-heal check —
   "config.js still holds a TEMPORARILY FLIPPED flag from an interrupted run" —
   fired on that marker and exited 1 with that message instead of the refusal,
   turning 4-5 tests above red for EVERY flag. `/flag-flip` step 4b could not
   complete at all, and its failure read as "your flag is not reversible" when
   nothing about the flag was involved.

   The guard is now scoped to a run that will WRITE. These two tests hold that
   scoping in both directions, because a guard deleted outright would pass the
   first one alone — and the guard is what stops a resumed run restoring
   config.js TO the wreckage it started on.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("flag reversibility gate — it can run inside its own suite", () => {
  test("a --plan-only run reads a marker-bearing config.js instead of aborting", () => {
    /* Safe without the forced --plan-only of gate(): it is passed explicitly
       here, and --plan-only exits before the first write. */
    const on = flags().filter((f) => f.on && !f.inert);
    expect(on.length, "need two ON unmarked flags to model an outer run").toBeGreaterThan(1);
    const [outer, target] = on;

    const r = inFixture(
      (src) =>
        src.replace(
          new RegExp(`^(\\s{4}${outer.name}:\\s*)true,`, "m"),
          `$1false, // ${MARKER} BY flag-reversibility.mjs`
        ),
      ["--flag", target.name, "--plan-only"]
    );

    expect(r.config, "the fixture never got a marker").toContain(MARKER);
    expect(r.code, `plan-only aborted on an outer run's own marker:\n${r.out}`).toBe(0);
    expect(r.out, "no plan was resolved").toContain(`1 target(s): ${target.name}`);
    /* And it says so, rather than resolving a plan off a mutated config in
       silence: the flipped flag reads as already-off to anyone reading this. */
    expect(r.out, "the marker passed unmentioned").toContain(`${MARKER} marker`);
  });

  test("a run that WILL write still refuses a marker-bearing config.js", () => {
    /* Safe without --plan-only ONLY because every flag in this fixture is off:
       --all selects ON flags, so targets is empty and the flip loop, the build
       and `npm test` are unreachable even with the guard deleted — the
       regression shows up as "nothing to verify", not as a suite inside a
       suite. Do not reuse this runner with a fixture that has an ON flag. */
    const r = inFixture(
      (src) =>
        src
          .replace(/^(\s{4}[a-zA-Z][a-zA-Z0-9]*:\s*)true,/gm, "$1false,")
          .replace(/^(\s{4}[a-zA-Z][a-zA-Z0-9]*:\s*)false,/m, `$1false, // ${MARKER} BY flag-reversibility.mjs`),
      ["--all"]
    );

    expect(r.config, "the fixture never got a marker").toContain(MARKER);
    expect(r.code, "the write path no longer refuses a marker-bearing config.js").toBe(1);
    expect(r.out).toContain(`still holds a ${MARKER} flag`);
    expect(r.out, "it went on to resolve targets instead of stopping").not.toContain("nothing to verify");
  });
});
