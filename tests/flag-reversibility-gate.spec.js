import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* ═══════════════════════════════════════════════════════════════════════════
   THE FLAG REVERSIBILITY GATE — what /flag-flip's flag-off half resolves.

   `scripts/verify/flag-reversibility.mjs` flips a flag to false, builds, and
   runs the suite. This spec holds the parts of it that can be checked without
   doing that: which flag it would flip, which it would not, and that it does
   not go blind or trip over its own marker.

   History: until 2026-10-03 this file's main job was proving the gate REFUSED
   a flag marked INERT-ON-V3 (read only by the incumbent surface). The
   incumbent and those flags were deleted together, and tests/flag-surface.spec.js
   now goes red on any flag V3 does not read, so there is nothing left to refuse.

   ⚠⚠ `gate()` BELOW FORCES --plan-only ON EVERY RUN, AND MUST KEEP DOING SO.
   The script's job is to rewrite config.js, build, and run `npm test`. Reached
   from inside a spec, that is `npm test` recursing into itself with config.js
   mutated — measured 2026-09-19: the suite ran for five minutes inside itself,
   and the outer kill left a `false, // TEMPORARILY FLIPPED` flag in the built
   `static/js/config.js` (the signal handler restores the SOURCE and skips the
   rebuild).
   ═══════════════════════════════════════════════════════════════════════════ */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(root, "src", "js", "config.js");
const GATE = join("scripts", "verify", "flag-reversibility.mjs");

/**
 * Run the gate; never throws, so an exit code is an assertable value.
 * ⚠ --plan-only is appended HERE so no test can forget it. See the header.
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

/** The flags and their defaults, parsed independently of the gate. */
function flags() {
  const src = readFileSync(CONFIG, "utf8");
  const start = src.indexOf("features:");
  const out = [];
  for (const m of src.slice(start).matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*):\s*(true|false),?([^\n]*)/gm)) {
    out.push({ name: m[1], on: m[2] === "true" });
  }
  return out;
}

/**
 * Run the gate against a THROWAWAY COPY of config.js, in a throwaway cwd.
 *
 * The script resolves `src/js/config.js` relative to its cwd, so a fixture dir
 * holding one file is a whole alternate repo as far as it is concerned.
 *
 * ⚠ This is the ONE runner here that does not force --plan-only, so every
 * caller owes a reason the write path is unreachable for its fixture. `mutate`
 * must change something: a fixture whose regex silently missed proves nothing.
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

test.describe("flag reversibility gate — what it resolves", () => {
  test("config.js offers both an ON and an OFF flag to test", () => {
    // Assert the fixtures are there before asserting anything about them.
    const f = flags();
    expect(f.length, "no flags parsed out of config.js").toBeGreaterThan(40);
    expect(f.filter((x) => x.on).length, "no ON flag").toBeGreaterThan(0);
    expect(f.filter((x) => !x.on).length, "no OFF flag").toBeGreaterThan(0);
  });

  test("an ON flag is planned, alone", () => {
    const target = flags().find((f) => f.on);
    const r = gate("--flag", target.name);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`single flag: ${target.name}`);
    expect(r.out).toContain(`1 target(s): ${target.name}`);
  });

  test("an OFF flag is not flipped — its off state is what ships", () => {
    const target = flags().find((f) => !f.on);
    const r = gate("--flag", target.name);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`${target.name} is already false`);
    expect(r.out).not.toContain("target(s)");
  });

  test("an unknown flag is an error, not a silent pass", () => {
    const r = gate("--flag", "noSuchFlagAnywhere");
    expect(r.code).toBe(1);
    expect(r.out).toContain("no such flag: noSuchFlagAnywhere");
  });

  test("--all plans every ON flag", () => {
    const on = flags().filter((f) => f.on);
    const r = gate("--all");
    expect(r.code).toBe(0);
    expect(r.out).toContain(`every ON flag (${on.length})`);
    expect(r.out).toContain(`${on.length} target(s)`);
  });

  test("a parser that sees no flags refuses rather than approving nothing", () => {
    /* Safe without --plan-only: the guard exits before any write, and with the
       guard deleted the gutted fixture has no ON flag, so --all reaches
       "nothing to verify" — never the flip loop. */
    const r = inFixture(
      (src) => src.replace(/^(\s{4})([a-zA-Z][a-zA-Z0-9]*):(\s*)(true|false),/gm, "$1// $2:$3$4,"),
      ["--all"]
    );
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("parsed only 0 flags");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE GATE SPEC RUNS INSIDE THE THING IT TESTS.

   A real `--flag X` run writes `false, // TEMPORARILY FLIPPED BY …` into
   config.js and then runs `npm test` to prove the off state passes. That suite
   contains THIS FILE, which spawns the gate again. So every assertion above is
   made while config.js carries the outer run's own marker.

   Between 7a181c6 and the fix, the script's start-up self-heal check fired on
   that marker and exited 1, turning this file red for EVERY flag. The guard is
   now scoped to a run that will WRITE. These two tests hold that scoping in
   both directions, because a guard deleted outright would pass the first alone.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("flag reversibility gate — it can run inside its own suite", () => {
  test("a --plan-only run reads a marker-bearing config.js instead of aborting", () => {
    // Safe: --plan-only is passed explicitly and exits before the first write.
    const on = flags().filter((f) => f.on);
    expect(on.length, "need two ON flags to model an outer run").toBeGreaterThan(1);
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
    expect(r.out, "the marker passed unmentioned").toContain(`${MARKER} marker`);
  });

  test("a run that WILL write still refuses a marker-bearing config.js", () => {
    /* Safe without --plan-only ONLY because every flag in this fixture is off:
       --all selects ON flags, so targets is empty and the flip loop, the build
       and `npm test` are unreachable even with the guard deleted. Do not reuse
       this runner with a fixture that has an ON flag. */
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
