import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/* ⚠ Line endings normalised. This repo is edited on Windows and git's autocrlf
   leaves CRLF in the working copy, so a needle written with \n here matches
   nothing on disk — which the third test in this file caught on its first run,
   and which is exactly the vacuous-pass it exists to prevent. */
const CSS = readFileSync(join(ROOT, "src/v3/css/compose.css"), "utf8").replace(/\r\n/g, "\n");
const SUBJECTS_DIR = join(ROOT, "src/v3/subjects");

/* ═══════════════════════════════════════════════════════════════════════════
   EVERY SUBJECT IS IN THE TWO ENUMERATED SELECTOR LISTS.

   compose.css has two hand-maintained lists of `.subject--*` selectors: the
   shared BOX (flex column, gap, padding, overflow) and the flat VEIL that makes
   text legible over a photograph. A subject missing from either one still
   mounts, still passes its own spec, and still looks plausible in a DOM read.
   It just comes out wrong on the wall.

   ⚠⚠ THIS HAS NOW HAPPENED THREE TIMES.
   · Phase 6: the contrast sweep found four surfaces with no veil, worst 1.00:1.
   · 2026-08-08: the scrim's gradient shape left a title over a bright sky.
   · 2026-08-16: the week strip shipped missing from BOTH lists — photographed
     on the wall bunched into the top third of the panel with its day names on
     pale cloud.

   Each time the fix was one line in a list, and each time the warning telling
   the next person to add it was ALREADY THERE. A comment cannot fail a build.
   This can.

   The kinds are read from the source rather than listed here on purpose: a
   manifest that has to be updated by hand is the same class of thing this test
   exists to replace.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Every `subject--<kind>` the registry can mount, read out of the modules. */
function subjectKinds() {
  const kinds = new Set();
  for (const file of readdirSync(SUBJECTS_DIR)) {
    if (!file.endsWith(".js")) continue;
    const src = readFileSync(join(SUBJECTS_DIR, file), "utf8");
    // The shared helper: frame("recipe") → .subject--recipe
    for (const m of src.matchAll(/\bframe\(\s*"([a-z-]+)"/g)) kinds.add(m[1]);
    // The hand-built ones, which set the class directly rather than via frame().
    for (const m of src.matchAll(/"subject subject--([a-z-]+)"/g)) kinds.add(m[1]);
  }
  return [...kinds].sort();
}

/* ⚠ COMMENTS ARE STRIPPED BEFORE PARSING, and the first version of this file
   did not do that. Both lists carry explanatory comments BETWEEN their
   selectors — that is where the warnings about joining the list live — so
   backing up from the rule's opening brace to the nearest comment terminator
   stops at a mid-list comment and reads only the last selector or two. The
   guard then reported eight false positives, including subjects that were
   correctly listed. */
const CSS_BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The selectors in the rule whose body contains `needle`. */
function selectorsOfRuleContaining(needle) {
  const at = CSS_BARE.indexOf(needle);
  if (at === -1) throw new Error(`compose.css no longer contains: ${needle}`);
  const open = CSS_BARE.lastIndexOf("{", at);
  const head = CSS_BARE.slice(0, open);
  const start = head.lastIndexOf("}") + 1;      // end of the previous rule
  return [...head.slice(start).matchAll(/\.subject--([a-z-]+)/g)].map((m) => m[1]);
}

/* ⚠ The subjects that are PHOTOGRAPHS filling the frame. Each lays itself out
   absolutely and takes a bottom caption band (.subject--camera::after,
   .subject--media::after) rather than a veil over its own answer. Excluding one
   is a real decision; forgetting one is not, and that distinction is the whole
   point of keeping this list here rather than widening the assertions.

   `media` is in the BOX list and then opts back out with `padding: 0; display:
   block` — so it is excluded from the veil only. camera and sky are in neither. */
const NO_BOX = ["camera", "sky"];
const NO_VEIL = ["camera", "media", "sky"];

test("every subject is in the shared box list", () => {
  const box = selectorsOfRuleContaining("padding: var(--safe);\n  overflow: hidden;");
  const missing = subjectKinds().filter((k) => !NO_BOX.includes(k) && !box.includes(k));

  expect(
    missing,
    `These subjects are not in compose.css's shared box list, so they are not ` +
      `flex columns: any \`flex: 1 1 auto\` inside them is inert, their content ` +
      `sizes to itself against the top edge, and they have no safe-area padding.\n` +
      missing.map((k) => `  .subject--${k}`).join("\n")
  ).toEqual([]);
});

test("every subject is in the veil list, or is deliberately excluded", () => {
  /* ⚠ THE CLOSING BRACE IS PART OF THE NEEDLE, and without it this test was
     silently reading the WRONG RULE. The identical color-mix appears earlier in
     the file as the first stop of the caption-band gradient
     (.subject--camera::after), so indexOf found that instead and reported every
     veiled subject as missing — a guard failing loudly for a false reason,
     which is only one step better than passing for a false one. The gradient's
     copy is followed by ` 0%,`; the veil's is the whole declaration. */
  const veil = selectorsOfRuleContaining(
    "background: color-mix(in oklch, var(--scrim-base) calc(var(--scrim-opacity) * 100%), transparent);\n}"
  );
  const missing = subjectKinds().filter((k) => !NO_VEIL.includes(k) && !veil.includes(k));

  expect(
    missing,
    `These subjects paint text over a photograph with NO veil under it. The ` +
      `gradient scrim is transparent by 88% of the frame height, so anything ` +
      `across the top is on bare picture — the sweep has measured this at ` +
      `1.00:1. Add each to the veil list in compose.css, or to PHOTOGRAPHIC ` +
      `or to NO_VEIL here if it is genuinely a full-frame image:\n` +
      missing.map((k) => `  .subject--${k}`).join("\n")
  ).toEqual([]);
});

test("the two lists are read from real rules, not from an empty match", () => {
  // A parser that silently returns [] would make both tests above vacuously
  // pass, which is the failure mode of every source-scanning guard.
  const box = selectorsOfRuleContaining("padding: var(--safe);\n  overflow: hidden;");
  const veil = selectorsOfRuleContaining(
    "background: color-mix(in oklch, var(--scrim-base) calc(var(--scrim-opacity) * 100%), transparent);\n}"
  );
  expect(box.length).toBeGreaterThan(5);
  expect(box).toContain("calendar");
  /* ⚠ The veil needle matched the caption-band gradient on its first run, whose
     rule carries exactly these two selectors. Asserting their ABSENCE is what
     tells the two rules apart — a length check alone would not have. */
  expect(veil.length).toBeGreaterThan(5);
  expect(veil).toContain("calendar");
  expect(veil).not.toContain("camera");
  expect(veil).not.toContain("media");
  expect(subjectKinds().length).toBeGreaterThan(8);
  expect(subjectKinds()).toContain("forecast");
});
