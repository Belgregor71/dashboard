#!/usr/bin/env node
/**
 * Known-defect pattern scanner, over the outgoing diff only.
 *
 * Each rule here encodes a bug this dashboard actually shipped and paid for.
 * It reports and points at the fix; it does NOT edit your files. A gate that
 * rewrites the working tree during `git push` means the commit you reviewed is
 * not the commit that deploys to the kiosk — and two of these three fixes
 * (brightness, hook order) are judgement calls with a visible consequence on a
 * screen that runs 24/7. You apply them.
 *
 * Usage: node scripts/verify/scan-patterns.mjs [--base <ref>]
 */

import { execFileSync } from "child_process";
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "origin/main";
const sh = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8" }).trim();

function changedJs() {
  let base = BASE;
  try {
    sh("git", ["rev-parse", "--verify", base]);
  } catch {
    base = sh("git", ["merge-base", "HEAD", "main"]);
  }
  return sh("git", ["diff", "--name-only", "--diff-filter=ACM", `${base}...HEAD`])
    .split("\n")
    .filter((f) => /\.(js|mjs|cjs)$/.test(f) && !f.includes("node_modules"));
}

export const RULES = [
  {
    id: "unguarded-slug",
    // Real bug: memory-studio slugify(undefined) -> "undefined", a truthy id
    // that collided every entry saved without an explicit id (fixed 3b364ca).
    test(src) {
      const hits = [];
      // A slug-ish function that coerces with String() but has no nullish guard.
      for (const m of src.matchAll(/function\s+(\w*[Ss]lug\w*)\s*\([^)]*\)\s*\{([\s\S]{0,400}?)\n\}/g)) {
        const [, name, body] = m;
        const guarded = /==\s*null|===\s*undefined|\?\?|typeof\s+\w+\s*!==?\s*["']string["']/.test(body);
        if (/String\(/.test(body) && !guarded) {
          hits.push({ line: src.slice(0, m.index).split("\n").length, detail: `${name}() coerces with String() but has no nullish guard` });
        }
      }
      return hits;
    },
    fix: 'add `if (s == null) return "";` as the first line — String(undefined) slugs to the truthy string "undefined" and collides ids'
  },
  {
    id: "hook-after-await",
    // Real bug: screensaver registered __ssNextPhoto after `await loadPhotos()`,
    // so a test (or a fast CDP drive) could reach the hook before it existed.
    // Must be scoped to the *same function body*. A file-wide "any await before
    // any hook" heuristic flags 32 sites in this codebase that are all fine —
    // the await lives in an unrelated function. Only an await that actually
    // suspends the path registering the hook can open the race.
    test(src) {
      const hits = [];
      const lines = src.split("\n");

      // Rough enclosing-function tracking by brace depth. Good enough here:
      // this codebase does not nest functions deeply, and the cost of a missed
      // exotic case is lower than the cost of a rule nobody trusts.
      let depth = 0;
      const fnStack = []; // { depth, line, sawAwait }
      lines.forEach((l, i) => {
        const code = l.replace(/\/\/.*$/, "");
        const opensFn = /\b(function\b|=>\s*\{|async\s*\()/.test(code) && code.includes("{");

        if (/^\s*(?:const|let|var)?\s*.*\bawait\s/.test(code) && fnStack.length) {
          fnStack[fnStack.length - 1].sawAwait ??= i + 1;
        }

        // Function-valued hooks only. `window.__CAL_EVENTS__ = expandedAll` is
        // a data export — it is the awaited data, so it cannot precede the
        // await and there is no race. The race is a driver calling
        // `window.__ssNextPhoto()` during the async gap and finding undefined.
        const m = code.match(/^\s*window\.(__\w+)\s*=\s*(?:async\s*)?(?:\(|function\b|[\w$]+\s*=>)/);
        if (m && fnStack.length) {
          const fn = fnStack[fnStack.length - 1];
          if (fn.sawAwait) {
            hits.push({
              line: i + 1,
              detail: `window.${m[1]} registered after an await on line ${fn.sawAwait} in the same function (opened line ${fn.line})`
            });
          }
        }

        const opens = (code.match(/\{/g) || []).length;
        const closes = (code.match(/\}/g) || []).length;
        if (opensFn) fnStack.push({ depth, line: i + 1, sawAwait: null });
        depth += opens - closes;
        while (fnStack.length && depth <= fnStack[fnStack.length - 1].depth) fnStack.pop();
      });
      return hits;
    },
    fix: "register window.__* hooks BEFORE the first await — anything driving the page over CDP can arrive during the async gap (CLAUDE.md: hooks registered after an async load completes)"
  },
  {
    id: "unclamped-brightness",
    // Real risk: the night dim curve has a floor (~0.3) so the clock never goes
    // invisible in the small hours. An unclamped opacity/dim expression can
    // reach 0 and black out the kiosk overnight, which nobody sees until 3am.
    // Scoped to the file, not the line: the real shape computes the curve into
    // a short local (`const d = 0.9 - alt / 90`) and writes it somewhere else
    // (`setProperty("--clock-dim", d)`), so a line-local regex misses it.
    // Rule: a file that writes a brightness-ish value must clamp *somewhere*.
    test(src) {
      const lines = src.split("\n");
      const writes = [];
      lines.forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return; // comment
        // Writing a brightness custom property counts on its own: the curve
        // that feeds it is usually computed a few lines up, out of regex reach.
        if (/setProperty\(\s*["'`]--[\w-]*(dim|opacity|bright|alpha)[\w-]*["'`]/i.test(l)) {
          writes.push({ line: i + 1, text: l.trim().slice(0, 80) });
          return;
        }
        // Direct assignments only count when the value is computed —
        // `opacity = 0.5` is a constant and cannot run away.
        if (!/(\.style\.opacity|\b(dim|brightness|opacity)\w*)\s*=\s*[^=]/i.test(l)) return;
        const rhs = l.split("=").slice(1).join("=");
        if (!/[a-z_$][\w$]*\s*[*/+-]|[*/+-]\s*[a-z_$]/i.test(rhs)) return;
        writes.push({ line: i + 1, text: l.trim().slice(0, 80) });
      });
      if (!writes.length) return [];
      if (/Math\.(max|min)|\bclamp\s*\(/.test(src)) return []; // file clamps somewhere
      return writes.map((w) => ({ line: w.line, detail: `computed brightness, no clamp anywhere in file: ${w.text}` }));
    },
    fix: "wrap in Math.max(FLOOR, …) — an unclamped dim curve can reach 0 and black the kiosk out overnight (see the ambient-clock 0.3 floor)"
  },
  {
    id: "absent-read-as-empty",
    // Real bugs, FIVE of them in a single day (2026-08-08): the calendar said
    // "nothing on today", the shopping list said "empty", the todo snapshot
    // returned [] on a disconnected HA, "what's playing" said "nothing's
    // playing", and the cameras said "nothing's triggered recently" — every one
    // of them while the upstream was simply DOWN.
    //
    // The shape is always identical: a collection defaulted with `?? []` (or an
    // optional chain that yields undefined), then a `.length === 0` branch that
    // states a FACT ABOUT THE WORLD. Absent and empty are different, and only
    // one of them is something the house is entitled to say out loud.
    //
    // Heuristic and deliberately narrow: it needs both the nullish default and
    // an emptiness-worded string nearby, and it stands down if the function
    // guards presence first. A rule nobody trusts gets disabled.
    test(src) {
      const hits = [];
      const lines = src.split("\n");
      const EMPTY_WORDS = /["'`][^"'`]*\b(nothing|no one|nobody|none|empty|is clear|all clear)\b[^"'`]*["'`]/i;

      lines.forEach((l, i) => {
        const code = l.replace(/\/\/.*$/, "");
        if (!EMPTY_WORDS.test(code)) return;
        if (!/\breturn\b/.test(code)) return;

        // Look back a short window for the tell: a collection that was given an
        // empty default rather than being checked for presence.
        const from = Math.max(0, i - 12);
        const window = lines.slice(from, i + 1).join("\n");
        const defaulted = /\?\?\s*(\[\]|\{\})/.test(window) || /\?\.\w+\s*\|\|\s*\[\]/.test(window);
        if (!defaulted) return;

        // Stand down if presence is actually established in the same window.
        // The last clause matters: `if (people.length === 0) return null;` IS a
        // presence guard — the function has already decided that an empty
        // collection means "no answer" rather than "an answer of none" — and
        // without it this rule flags the one implementation that got it right.
        const guarded =
          /Array\.isArray\s*\(|==\s*null|!=\s*null|===\s*undefined|\.known\b|hasOwnProperty/.test(window) ||
          /length\s*===?\s*0\s*\)\s*return null/.test(window);
        if (guarded) return;

        hits.push({
          line: i + 1,
          detail: `states emptiness (${code.trim().slice(0, 60)}) from a collection defaulted with ?? [] — an upstream being DOWN would read as data being ABSENT`
        });
      });
      return hits;
    },
    fix: "check the data ARRIVED before speaking about it — `if (!Array.isArray(x)) return null;` — so a dead upstream falls through instead of confidently reporting 'nothing'"
  }
];

/** Apply every rule to a list of files. Exported so the rules can be swept
 *  across the whole codebase to check their false-positive rate. */
export function scan(fileList) {
  const found = [];
  for (const file of fileList) {
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const rule of RULES) {
      for (const hit of rule.test(src)) found.push({ file, rule, ...hit });
    }
  }
  return found;
}

function main() {
  const files = changedJs();
  if (!files.length) {
    console.log("[patterns] no changed JS — nothing to scan");
    return 0;
  }

  const found = scan(files);
  console.log(`[patterns] scanned ${files.length} changed JS file(s)`);

  if (!found.length) {
    console.log("[patterns] pass — no known-defect patterns");
    return 0;
  }

  console.error(`\n[patterns] FAIL — ${found.length} known-defect pattern(s):\n`);
  const byRule = {};
  for (const f of found) (byRule[f.rule.id] ??= []).push(f);
  for (const [id, hits] of Object.entries(byRule)) {
    console.error(`  ${id}`);
    for (const h of hits) console.error(`    ${h.file}:${h.line} — ${h.detail}`);
    console.error(`    fix: ${hits[0].rule.fix}\n`);
  }
  console.error("  Fix these, or if a hit is a false positive, push with --no-verify and say why.\n");
  return 1;
}

// Only scan the diff when run as a script; importing gets RULES + scan().
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scan-patterns.mjs")) {
  process.exit(main());
}
