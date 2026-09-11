import { test, expect } from "@playwright/test";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, sep, extname } from "node:path";

/* ═══════════════════════════════════════════════════════════════════════════
   WHICH FLAGS ARE A LEVER ON THE WALL — audit F1(a), 2026-09-11.

   CLAUDE.md calls flipping a flag off "the rollback path". That is only true of
   a flag the serving surface reads, and `/` serves V3. The 2026-09-10 audit
   found a large block of flags whose only readers are incumbent modules —
   mostly `src/js/core/app.js`, which V3 never imports — so on the live wall
   setting one to false changes nothing, and /flag-flip's flag-off half passes
   while proving nothing.

   `src/js/config.js` now marks each of those flags `INERT-ON-V3`. A mark only
   warns whoever reads it, and a stale one reads exactly like a true one, so
   this spec DERIVES the set from V3's import closure and compares:

     1. the scan sees what it claims to see     → a blind scan passes everything
     2. every flag V3 never reads is marked     → a V3 gate removed, or a new
                                                  incumbent-only flag
     3. no flag V3 reads is marked              → a V3 gate added and the mark
                                                  left behind
     4. every marked flag has an incumbent reader → "incumbent-only" of a flag
                                                  nothing reads at all
     5. every read form is one this scan knows  → a new helper this scan cannot
                                                  see, reading a flag it would
                                                  then call inert
     6. every `V3 lever:` names a flag V3 reads → a pointer to a second dead lever

   ⚠ A red 2 or 3 is not a mark to refresh until green. It means the lever
   under a flag just appeared or disappeared on the live surface — read the
   change that did it, then move the mark.

   ⚠ The audit's own count (31) was WRONG, low by 11, in two directions that
   this spec exists to not repeat:
     · it counted a flag name inside a COMMENT as a read — six flags were
       "read" by V3 only in prose such as `(features.cameraCandidate)`. So
       comments are stripped before anything is matched.
     · it counted any quoted occurrence of the name as a read — so `commute`,
       `weather`, `calendar` and `plex` looked live on V3 through strings like
       `refs: ["weather"]` and `cell: "plex"`. So a read is a READ FORM (below),
       never a bare string.
   It was also checked against the production bundle, and the bundle half of
   that check was blind too: V3's shared modules live in a separate chunk
   (`entityFeed-*.js`), not in `v3-*.js`.
   ═══════════════════════════════════════════════════════════════════════════ */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");
const CONFIG = join(SRC, "js", "config.js");

const MARK = "INERT-ON-V3";

/* The helpers a flag is read through by name. Each one is a one-line
   `Boolean(CONFIG?.features?.[name])` (app.js's isEnabled adds a default).
   Assertion 5 fails if a dynamic `features[…]` read turns up anywhere else. */
const HELPERS = ["flag", "featureOn", "isEnabled"];

/* ── comment stripping ─────────────────────────────────────────────────────
   Strings, template literals (with nested `${}`) and regex literals are kept
   verbatim, so a name inside them still counts; comments go. The regex rule is
   the standard heuristic — a `/` opens a literal only where a value cannot end
   — which is sufficient for this tree and checked by assertion 1: the import
   closure computed from stripped source must equal the one from raw source, so
   a stripper that swallowed code would lose edges and go red there. */
function stripComments(src) {
  let out = "";
  let i = 0;
  let braces = 0;
  let lastSig = "";
  const templateReturns = [];
  const n = src.length;

  const regexAllowed = () =>
    lastSig === "" ||
    /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSig) ||
    /\b(return|typeof|case|do|else|in|of|void|yield|await)$/.test(out.trimEnd());

  const readTemplate = () => {
    while (i < n) {
      const c = src[i];
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { out += c; i++; lastSig = "`"; return; }
      if (c === "$" && src[i + 1] === "{") {
        out += "${"; i += 2; templateReturns.push(braces); braces++; lastSig = "{";
        return;
      }
      out += c; i++;
    }
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; lastSig = c;
      continue;
    }
    if (c === "`") { out += c; i++; readTemplate(); continue; }
    if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      out += src.slice(i, j); i = j; lastSig = "/";
      continue;
    }
    if (c === "{") braces++;
    if (c === "}") {
      braces--;
      if (templateReturns.length && templateReturns[templateReturns.length - 1] === braces) {
        templateReturns.pop(); out += c; i++; readTemplate();
        continue;
      }
    }
    out += c; i++;
    if (!/\s/.test(c)) lastSig = c;
  }
  return out;
}

/* ── the closure walk ──────────────────────────────────────────────────────
   Same walk as tests/v3-closure.spec.js, entered from each surface's own
   `<script type="module">` rather than a hardcoded file, so a moved entry is
   followed rather than silently left behind. config.js itself arrives by a
   plain `<script>` on both surfaces and declares the flags; it reads none. */
const source = new Map();
const stripped = new Map();
const rawOf = (f) => {
  if (!source.has(f)) source.set(f, readFileSync(f, "utf8"));
  return source.get(f);
};
const codeOf = (f) => {
  if (!stripped.has(f)) stripped.set(f, stripComments(rawOf(f)));
  return stripped.get(f);
};

function moduleEntry(html) {
  const text = readFileSync(join(SRC, html), "utf8");
  const m = text.match(/<script\s+type="module"\s+src="([^"]+)"/);
  if (!m) return null;
  return m[1].startsWith("/") ? join(SRC, m[1]) : resolve(dirname(join(SRC, html)), m[1]);
}

function importClosure(entry, read) {
  const seen = new Set();
  const stack = [resolve(entry)];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const specifiers = /(?:from|import)\s*["'](\.[^"']+)["']/g;
    let match;
    while ((match = specifiers.exec(read(file)))) {
      let target = resolve(dirname(file), match[1]);
      if (!existsSync(target) && existsSync(`${target}.js`)) target = `${target}.js`;
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.js");
      if (existsSync(target) && [".js", ".mjs", ".cjs"].includes(extname(target))) stack.push(target);
    }
  }
  return seen;
}

const rel = (f) => relative(root, f).split(sep).join("/");

/* ── the flags, and what counts as reading one ─────────────────────────────── */

function declaredFlags() {
  const lines = readFileSync(CONFIG, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*features:\s*\{\s*$/.test(l));
  const flags = [];
  let flagLines = 0;
  for (let i = start + 1; i < lines.length && !/^ {2}\},?\s*$/.test(lines[i]); i++) {
    if (/^ {4}\w+:\s*(true|false)\b/.test(lines[i])) flagLines++;
    const m = lines[i].match(/^ {4}(\w+):\s*(true|false),?\s*(?:\/\/(.*))?$/);
    if (m) {
      const comment = m[3] || "";
      const lever = comment.match(/V3 lever:\s*`?(\w+)`?/);
      flags.push({ name: m[1], marked: comment.includes(MARK), lever: lever ? lever[1] : null });
    }
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
  const incEntry = moduleEntry("index.html");
  const v3 = [...importClosure(v3Entry, codeOf)];
  const inc = [...importClosure(incEntry, codeOf)];
  const { flags, flagLines, start } = declaredFlags();

  const readersIn = (files, name) => {
    const re = readForm(name);
    return files.filter((f) => f !== CONFIG && re.test(codeOf(f))).map(rel);
  };
  const verdicts = flags.map((f) => ({
    ...f,
    v3Readers: readersIn(v3, f.name),
    incReaders: readersIn(inc, f.name)
  }));
  return { v3Entry, incEntry, v3, inc, flags: verdicts, flagLines, start };
}

test.describe("flag surface — INERT-ON-V3 marks (audit F1a)", () => {
  test("the scan sees the flags, both closures and both verdicts", () => {
    const s = scan();

    /* Assert the nodes are there before asserting anything about them: an
       unparsed block, a missed entry or an empty closure all make 2 and 3
       vacuous rather than red. */
    expect(s.start, "config.js has no `features: {` block").toBeGreaterThan(-1);
    expect(s.v3Entry && existsSync(s.v3Entry), "src/v3/index.html has no module entry").toBe(true);
    expect(s.incEntry && existsSync(s.incEntry), "src/index.html has no module entry").toBe(true);
    expect(
      s.flags.length,
      `parsed ${s.flags.length} flags but config.js has ${s.flagLines} flag lines — ` +
        `a line this parser does not understand would be skipped by every check below`
    ).toBe(s.flagLines);
    expect(s.flags.length).toBeGreaterThan(40);
    expect(rel(s.v3Entry)).toBe("src/v3/main.js");
    expect(s.v3.map(rel)).toContain("src/js/services/attentionEngine.js");
    expect(s.v3.map(rel)).not.toContain("src/js/core/app.js");

    expect(s.flags.filter((f) => f.v3Readers.length).length, "no flag reads as live on V3").toBeGreaterThan(0);
    expect(s.flags.filter((f) => !f.v3Readers.length).length, "no flag reads as inert on V3").toBeGreaterThan(0);

    /* The stripper self-check. Every import edge in raw source must survive
       stripping; one that does not means code was eaten, and a flag read on the
       same stretch would be reported inert. */
    const raw = [...importClosure(s.v3Entry, rawOf)].map(rel).sort();
    expect(s.v3.map(rel).sort(), "stripping comments changed V3's import closure").toEqual(raw);
  });

  test("every flag V3 never reads carries the INERT-ON-V3 mark", () => {
    const missing = scan().flags.filter((f) => !f.v3Readers.length && !f.marked);
    expect(
      missing.map((f) => `${f.name}  (read only by: ${f.incReaders.join(", ") || "nothing"})`),
      `These flags are not read by any module V3 loads, so they are not a lever ` +
        `on the wall — but config.js does not say so. If a V3 gate was just ` +
        `removed, that is the change to look at; otherwise append ` +
        `"// ⛔ ${MARK} (incumbent-only)" to each line.`
    ).toEqual([]);
  });

  test("no flag V3 reads carries the INERT-ON-V3 mark", () => {
    const stale = scan().flags.filter((f) => f.v3Readers.length && f.marked);
    expect(
      stale.map((f) => `${f.name}  (read on V3 by: ${f.v3Readers.join(", ")})`),
      `These are marked ${MARK} but V3 now reads them — the lever is connected. ` +
        `Remove the mark: a stale one teaches the next reader to distrust the rest.`
    ).toEqual([]);
  });

  test("every INERT-ON-V3 flag is read by the incumbent", () => {
    const orphaned = scan().flags.filter((f) => f.marked && !f.incReaders.length);
    expect(
      orphaned.map((f) => f.name),
      `Marked incumbent-only, but no incumbent module reads them either — the flag ` +
        `gates nothing on any surface. That is audit F1(c), retirement, not a mark.`
    ).toEqual([]);
  });

  test("every named V3 lever is a real flag that V3 reads", () => {
    /* `· V3 lever: v3Archive` tells the next session which flag to flip INSTEAD.
       A pointer at a flag that was renamed, retired or is itself inert on V3
       sends that session to a second dead lever with more confidence than the
       first — so it is checked like the mark it rides on. */
    const flags = scan().flags;
    const byName = new Map(flags.map((f) => [f.name, f]));
    const named = flags.filter((f) => f.lever);
    expect(named.length, "no mark names a V3 lever — the parser has gone blind").toBeGreaterThan(0);

    const bad = named
      .map((f) => {
        const target = byName.get(f.lever);
        if (!f.marked) return `${f.name}: names a V3 lever but is not marked ${MARK}`;
        if (!target) return `${f.name}: V3 lever "${f.lever}" is not a flag in config.js`;
        if (!target.v3Readers.length) return `${f.name}: V3 lever "${f.lever}" is not read by V3 either`;
        return null;
      })
      .filter(Boolean);
    expect(bad, `A V3 lever pointer is wrong:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  test("every flag read form is one this scan understands", () => {
    /* A dynamic `features[…]` / bare `.features` read outside a known helper
       could read ANY flag by a name this scan never sees — and the flag would
       then be called inert and marked, which is the wrong-lever failure this
       spec exists to prevent, arriving from the other side. */
    const { v3, inc } = scan();
    const helperDef = new RegExp(
      `\\bfunction\\s+(?:${HELPERS.join("|")})\\s*\\(|\\bconst\\s+(?:${HELPERS.join("|")})\\s*=`
    );
    const unknown = [...new Set([...v3, ...inc])]
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
