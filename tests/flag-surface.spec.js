import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SRC, rel, rawOf, codeOf, moduleEntry, importClosure } from "./fixtures/source-scan.js";

/* ═══════════════════════════════════════════════════════════════════════════
   EVERY FLAG IS A LEVER ON THE WALL — audit F1(a) 2026-09-11, tightened when
   the incumbent was retired on 2026-10-03.

   CLAUDE.md calls flipping a flag off "the rollback path". That is only true of
   a flag the serving surface reads. The 2026-09-10 audit found a block of flags
   whose only readers were incumbent modules; for a year they carried an
   "INERT-ON-V3" mark. The incumbent and those 37 flags were deleted together
   (docs/audit/INCUMBENT-RETIREMENT-2026-10-03.md), so the rule is now simply:
   a flag nothing on the wall reads does not exist. This spec DERIVES that from
   V3's import closure:

     1. the scan sees what it claims to see     → a blind scan passes everything
     2. every flag is read by a module V3 loads → a dead lever: a gate removed,
                                                  or a flag added with no reader
     3. no INERT-ON-V3 mark comes back          → the two-surface vocabulary
                                                  returning without a second surface
     4. every read form is one this scan knows  → a new helper this scan cannot
                                                  see, reading a flag it would
                                                  then call dead

   ⚠ A red 2 is not a flag to delete until green. It means a lever under a flag
   just disappeared from the wall — read the change that did it first.

   Lessons from the audit's own count (31, WRONG, low by 11) still hold here:
     · a flag name inside a COMMENT is not a read — comments are stripped first;
     · a quoted name is not a read (`cell: "plex"`) — only a READ FORM counts.
   ═══════════════════════════════════════════════════════════════════════════ */

const CONFIG = join(SRC, "js", "config.js");

const MARK = "INERT-ON-V3";

/* The helpers a flag is read through by name. Each one is a one-line
   `Boolean(CONFIG?.features?.[name])`. Assertion 4 fails if a dynamic
   `features[…]` read turns up anywhere else. */
const HELPERS = ["flag", "featureOn", "isEnabled"];

/* ── the flags, and what counts as reading one ─────────────────────────────── */

function declaredFlags() {
  const lines = readFileSync(CONFIG, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*features:\s*\{\s*$/.test(l));
  const flags = [];
  let flagLines = 0;
  for (let i = start + 1; i < lines.length && !/^ {2}\},?\s*$/.test(lines[i]); i++) {
    if (/^ {4}\w+:\s*(true|false)\b/.test(lines[i])) flagLines++;
    const m = lines[i].match(/^ {4}(\w+):\s*(true|false),?\s*(?:\/\/(.*))?$/);
    if (m) flags.push({ name: m[1], comment: m[3] || "" });
  }
  return { flags, flagLines, start };
}

/* A READ is one of these, never a bare string. `flag: "x"` is the table form
   (v3/core/commands.js, services/localIntents.js) whose entries go through a
   helper by property. */
function readForm(name) {
  const q = `["'\`]${name}["'\`]`;
  return new RegExp(
    `features\\??\\.${name}\\b` +
      `|features\\??\\.?\\[\\s*${q}\\s*\\]` +
      `|\\b(?:${HELPERS.join("|")})\\(\\s*${q}` +
      `|\\bflag:\\s*${q}`
  );
}

function scan() {
  const v3Entry = moduleEntry("v3/index.html");
  const v3 = [...importClosure(v3Entry, codeOf)];
  const { flags, flagLines, start } = declaredFlags();
  const verdicts = flags.map((f) => {
    const re = readForm(f.name);
    return { ...f, v3Readers: v3.filter((file) => file !== CONFIG && re.test(codeOf(file))).map(rel) };
  });
  return { v3Entry, v3, flags: verdicts, flagLines, start };
}

test.describe("flag surface — every flag is a lever on V3", () => {
  test("the scan sees the flags and V3's closure", () => {
    const s = scan();

    /* Assert the nodes are there before asserting anything about them: an
       unparsed block, a missed entry or an empty closure all make 2 vacuous. */
    expect(s.start, "config.js has no `features: {` block").toBeGreaterThan(-1);
    expect(s.v3Entry && existsSync(s.v3Entry), "src/v3/index.html has no module entry").toBe(true);
    expect(
      s.flags.length,
      `parsed ${s.flags.length} flags but config.js has ${s.flagLines} flag lines — ` +
        `a line this parser does not understand would be skipped by every check below`
    ).toBe(s.flagLines);
    expect(s.flags.length).toBeGreaterThan(40);
    expect(rel(s.v3Entry)).toBe("src/v3/main.js");
    expect(s.v3.map(rel)).toContain("src/js/services/attentionEngine.js");
    expect(s.flags.filter((f) => f.v3Readers.length).length, "no flag reads as live on V3").toBeGreaterThan(40);

    /* The stripper self-check. Every import edge in raw source must survive
       stripping; one that does not means code was eaten, and a flag read on the
       same stretch would be reported dead. */
    const raw = [...importClosure(s.v3Entry, rawOf)].map(rel).sort();
    expect(s.v3.map(rel).sort(), "stripping comments changed V3's import closure").toEqual(raw);
  });

  test("every flag is read by a module V3 loads", () => {
    const dead = scan().flags.filter((f) => !f.v3Readers.length).map((f) => f.name);
    expect(
      dead,
      `These flags are not read by any module the wall loads, so flipping them ` +
        `changes nothing and is not a rollback. If a V3 gate was just removed, ` +
        `that is the change to look at; otherwise delete the flag.`
    ).toEqual([]);
  });

  test(`no ${MARK} mark comes back`, () => {
    const marked = scan().flags.filter((f) => f.comment.includes(MARK)).map((f) => f.name);
    expect(marked, `There is one surface; a flag cannot be inert on it and still be a flag.`).toEqual([]);
  });

  test("every flag read form is one this scan understands", () => {
    /* A dynamic `features[…]` / bare `.features` read outside a known helper
       could read ANY flag by a name this scan never sees — and the flag would
       then be called dead. */
    const { v3 } = scan();
    const helperDef = new RegExp(
      `\\bfunction\\s+(?:${HELPERS.join("|")})\\s*\\(|\\bconst\\s+(?:${HELPERS.join("|")})\\s*=`
    );
    const unknown = v3
      .filter((f) => f !== CONFIG)
      /* `.features` NOT followed by `?.name` / `.name` — i.e. `?.[name]`, or
         the object taken whole into an alias (`cfg.features || {}`). */
      .filter((f) => /\.features\b(?!\s*\??\.\s*\w)/.test(codeOf(f)) && !helperDef.test(codeOf(f)))
      .map(rel);
    expect(
      unknown,
      `These files read CONFIG.features by a form other than \`features?.name\` ` +
        `and define none of the known helpers (${HELPERS.join(", ")}). Add the ` +
        `helper's name to HELPERS so the flags it reads are seen.`
    ).toEqual([]);
  });
});
