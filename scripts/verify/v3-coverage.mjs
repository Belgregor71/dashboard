#!/usr/bin/env node
/**
 * V3 RUNTIME COVERAGE — the answer to V3-CUTOVER.md §5.
 *
 * The graph said "17 of 29 V3 files have no edge to any spec". That metric is
 * structurally incapable of being right: Playwright drives a browser and never
 * imports the modules, so no static edge can exist for any of them. The only
 * honest measurement is a runtime one, and V3 runs in TWO places:
 *
 *   browser  the specs' page.goto("/v3/") loads dist/assets/v3-*.js
 *            → tests/fixtures/coverage.js records raw V8 JS coverage per test
 *   node     8 V3 modules are ALSO imported directly by specs and called as
 *            plain functions in the worker process
 *            → NODE_V8_COVERAGE=coverage/raw-node writes it for free
 *
 * A pass that took only the first would report grammar.js and composer.js as
 * dead; a pass that took only the second would see almost nothing. Both, merged
 * on source position, is the measurement.
 *
 * METRIC: functions executed at least once, positioned by the BROWSER side and
 * merged with the node side BY NAME.
 *
 * ⚠⚠ THE NODE SIDE'S OFFSETS ARE NOT OFFSETS INTO THE FILE ON DISK. Playwright's
 * loader runs every imported module through its own transform, so the script V8
 * measured is ~3x the size of the file (`v8SpanEnd=51095` vs `fileBytes=18146`
 * for attention.js) and every line derived from it is off — by two lines here,
 * by whatever the transform did in general. The first version of this script
 * merged the two runtimes on `file:line:col` and the shift meant they NEVER
 * merged: health.js pulls in attention.js transitively, node reported its whole
 * API as unexecuted at shifted positions, and the report claimed `initAttention`
 * and `setDepth` never ran — which cannot be true of a surface that boots. 🔑 A
 * coverage report's failure mode is a plausible answer, not an error.
 *
 * So: positions come from the browser (bundle + sourcemap, self-checked below at
 * 99.6%), and the node side contributes only "a function of this name, in this
 * file, ran". Anonymous node-side functions are therefore not counted — they are
 * arrows inside modules the browser also loads, and the browser has them.
 *
 * Usage:
 *   npm run verify:v3-coverage      # build + run the 13 specs + report
 *   node scripts/verify/v3-coverage.mjs   # re-report from raw data already taken
 *
 * ⚠ AFTERWARDS, `npm run build` — the pass leaves dist/ holding the unminified
 * coverage bundle, which is not what should be served or shipped.
 *
 * ⚠ The build MUST be the coverage build. Against the production bundle every
 * range attributes to `assets/v3-*.js` (no map), minification moves statements,
 * and tree-shaking deletes unexercised exports so they never count as uncovered
 * at all. See vite.coverage.config.js.
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BROWSER_DIR = path.join(ROOT, "coverage", "raw-browser");
const NODE_DIR = path.join(ROOT, "coverage", "raw-node");
const DIST_ASSETS = path.join(ROOT, "dist", "assets");
const V3_REL = "src/v3/";

/* --------------------------------------------------------------- collection */

/**
 * `--run` does the whole pass. It exists mostly so the env vars are set the same
 * way every time: `V3_COVERAGE=1 npx playwright test` is not a command a Windows
 * shell will run, and a pass taken with one of the two variables missing looks
 * like a finding rather than a mistake.
 */
function collect() {
  /* One string per step, not (cmd, args[]): with `shell: true` node warns that
     argv is concatenated rather than escaped (DEP0190). Nothing here is user
     input, but a warning printed in the middle of a verification run is noise
     that makes a clean pass look unclean. */
  const steps = [
    ["npx vite build --config vite.coverage.config.js", {}],
    ["node scripts/copy-static-config.js", {}],
    [
      "npx playwright test --config playwright.coverage.config.js",
      { V3_COVERAGE: "1", NODE_V8_COVERAGE: path.join("coverage", "raw-node") }
    ]
  ];
  fs.rmSync(path.join(ROOT, "coverage"), { recursive: true, force: true });
  for (const [cmd, env] of steps) {
    console.log(`\n$ ${cmd}`);
    const res = spawnSync(cmd, {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, ...env }
    });
    if (res.status !== 0) {
      console.error(`\n${cmd} failed (${res.status}) — coverage not taken.`);
      process.exit(1);
    }
  }
}

/* ---------------------------------------------------------------- sourcemap */

const B64 = new Map();
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  .split("")
  .forEach((c, i) => B64.set(c, i));

function decodeVLQ(segment) {
  const out = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64.get(ch);
    if (digit === undefined) throw new Error(`bad base64-VLQ character: ${ch}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      const negative = value & 1;
      value >>>= 1;
      out.push(negative ? -value : value);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/**
 * `mappings` → per-generated-line arrays of {genCol, srcIdx, srcLine, srcCol}.
 * Only the generated column resets per line; the source fields are cumulative
 * across the whole string, which is the part that is easy to get wrong and
 * produces a map that is plausible everywhere and correct nowhere.
 */
function parseMappings(mappings) {
  const perLine = [];
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  for (const lineStr of mappings.split(";")) {
    let genCol = 0;
    const entries = [];
    for (const seg of lineStr.split(",")) {
      if (!seg) continue;
      const f = decodeVLQ(seg);
      genCol += f[0];
      if (f.length >= 4) {
        srcIdx += f[1];
        srcLine += f[2];
        srcCol += f[3];
        entries.push({ genCol, srcIdx, srcLine, srcCol });
      }
    }
    perLine.push(entries);
  }
  return perLine;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function offsetToLineCol(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, col: offset - starts[lo] };
}

/** Bundle text + parsed map, loaded once per asset. */
const bundles = new Map();

function loadBundle(basename) {
  if (bundles.has(basename)) return bundles.get(basename);
  const jsPath = path.join(DIST_ASSETS, basename);
  const mapPath = `${jsPath}.map`;
  if (!fs.existsSync(jsPath) || !fs.existsSync(mapPath)) {
    bundles.set(basename, null);
    return null;
  }
  const text = fs.readFileSync(jsPath, "utf8");
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const bundle = {
    text,
    starts: lineStarts(text),
    perLine: parseMappings(map.mappings),
    /* Map `sources` are relative to the map file; carry repo-relative posix
       paths so browser and node identities can be compared as strings. */
    sources: map.sources.map((s) =>
      path.relative(ROOT, path.resolve(DIST_ASSETS, s)).split(path.sep).join("/")
    )
  };
  bundles.set(basename, bundle);
  return bundle;
}

/** Nearest mapping at or before a generated position — the standard lookup. */
function originalPositionFor(bundle, offset) {
  const { line, col } = offsetToLineCol(bundle.starts, offset);
  for (let l = Math.min(line, bundle.perLine.length - 1); l >= 0; l--) {
    const entries = bundle.perLine[l];
    if (!entries || !entries.length) continue;
    let best = null;
    for (const e of entries) {
      if (l < line || e.genCol <= col) best = e;
      else break;
    }
    if (best) {
      return {
        source: bundle.sources[best.srcIdx],
        line: best.srcLine + 1,
        col: best.srcCol
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ merging */

/** key `file:line:col` (BROWSER positions only) → the function record. */
const fns = new Map();

/** `file::name` executed somewhere in a Playwright worker. Names, not positions. */
const nodeExecuted = new Set();

/** Names node saw run that the browser never reported a position for. */
const nodeOrphans = new Set();

/** functionName → does the mapped source line actually contain it? */
const mapCheck = { hit: 0, miss: 0, examples: new Set() };

/** Rollup suffixes `$1`/`$2` onto identifiers that collide when modules are
    concatenated (two V3 files both export `flag`). The stem is the source name. */
const stem = (name) => name.replace(/\$\d+$/, "");

/* `--probe=src/v3/core/attention.js:174` dumps every record landing at (or under)
   a position. A CLI flag rather than an env var on purpose: tests/env-example.spec
   scans scripts/ for `process.env` reads and requires each one to be documented in
   .env.example, and a debug switch for a verification script is not house config. */
const PROBE = (process.argv.find((a) => a.startsWith("--probe=")) || "").slice(8);

function record(file, line, col, endLine, name, executed, offset) {
  const key = `${file}:${line}:${col}`;
  if (PROBE && key.startsWith(PROBE)) {
    console.error(`PROBE ${key} <- offset=${offset} name=${name} exec=${executed}`);
  }
  let entry = fns.get(key);
  if (!entry) {
    entry = { file, line, col, endLine, name, browser: false, node: false };
    fns.set(key, entry);
  }
  if (name && !entry.name) entry.name = name;
  if (endLine > entry.endLine) entry.endLine = endLine;
  entry.browser = entry.browser || executed;
  entry.seen = (entry.seen || 0) + 1;
}

/**
 * SELF-CHECK on the hand-rolled VLQ decoder. A sourcemap that is wrong by a few
 * lines produces a report that looks entirely reasonable and names the wrong
 * functions — the failure mode here is a plausible answer, not an error. So:
 * V8's `functionName` comes from the BUNDLE, and the line text comes from the
 * ORIGINAL file at the position the map claims. If the decoder is right they
 * agree; if it is off by even one line they mostly do not.
 */
function checkMapping(file, line, name) {
  if (!name || /^[^a-zA-Z_$]/.test(name)) return;
  const text = sourceLine(file, line);
  if (text.includes(stem(name))) mapCheck.hit++;
  else {
    mapCheck.miss++;
    /* Deduped: the same function is re-reported by every capture, and eight
       copies of one line reads as eight problems. */
    mapCheck.examples.add(`${file}:${line} ${name} → ${text.slice(0, 60)}`);
  }
}

/** V8's whole-script wrapper is not a function anyone wrote. */
const isWholeScript = (fn, length) =>
  fn.ranges.length > 0 && fn.ranges[0].startOffset === 0 && fn.ranges[0].endOffset >= length;

function readBrowser() {
  if (!fs.existsSync(BROWSER_DIR)) return 0;
  const files = fs.readdirSync(BROWSER_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const entries = JSON.parse(fs.readFileSync(path.join(BROWSER_DIR, f), "utf8"));
    for (const script of entries) {
      const bundle = loadBundle(path.basename(new URL(script.url).pathname));
      if (!bundle) continue;
      for (const fn of script.functions) {
        if (!fn.ranges.length || isWholeScript(fn, bundle.text.length)) continue;
        const pos = originalPositionFor(bundle, fn.ranges[0].startOffset);
        if (!pos || !pos.source.startsWith(V3_REL)) continue;
        const end = originalPositionFor(bundle, fn.ranges[0].endOffset);
        const endLine = end && end.source === pos.source ? end.line : pos.line;
        checkMapping(pos.source, pos.line, fn.functionName);
        record(pos.source, pos.line, pos.col, endLine, fn.functionName, fn.ranges[0].count > 0, fn.ranges[0].startOffset);
      }
    }
  }
  return files.length;
}

/**
 * NODE_V8_COVERAGE writes one file per process — every Playwright worker, plus
 * the test server. NAMES ONLY: see the header. The offsets in here index
 * Playwright's transformed copy of the module, not the file on disk, so a
 * position taken from this data is wrong in a way that reads as a real finding.
 */
function readNode() {
  if (!fs.existsSync(NODE_DIR)) return 0;
  const files = fs.readdirSync(NODE_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(path.join(NODE_DIR, f), "utf8"));
    } catch {
      continue; /* a worker killed mid-write leaves a truncated file */
    }
    for (const script of payload.result || []) {
      if (!script.url || !script.url.startsWith("file:")) continue;
      const rel = path.relative(ROOT, fileURLToPath(script.url)).split(path.sep).join("/");
      if (!rel.startsWith(V3_REL)) continue;
      for (const fn of script.functions) {
        if (!fn.ranges.length || !fn.functionName) continue;
        if (fn.ranges[0].count > 0) nodeExecuted.add(`${rel}::${stem(fn.functionName)}`);
      }
    }
  }
  return files.length;
}

/** Fold the node facts onto the browser-positioned table. */
function mergeNode() {
  const positioned = new Set();
  for (const entry of fns.values()) {
    if (!entry.name) continue;
    const key = `${entry.file}::${stem(entry.name)}`;
    positioned.add(key);
    if (nodeExecuted.has(key)) entry.node = true;
  }
  /* A name node ran that the browser never gave a position for. Expected to be
     empty — every V3 file is in the v3 chunk — so a non-empty list means the
     browser side missed something and the totals below are short. */
  for (const key of nodeExecuted) if (!positioned.has(key)) nodeOrphans.add(key);
}

/* ------------------------------------------------------------------- report */

function sourceLine(file, line) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/)[line - 1].trim();
  } catch {
    return "";
  }
}

if (process.argv.includes("--run")) collect();

const browserFiles = readBrowser();
const nodeFiles = readNode();
mergeNode();

if (!browserFiles && !nodeFiles) {
  console.error("No raw coverage found. Take a pass first: npm run verify:v3-coverage");
  process.exit(1);
}

/* ⚠ The captures are useless without the map that positions them, and the most
   likely reason it is gone is the `npm run build` this pass tells you to run
   afterwards — the production bundle ships no .map. Left to itself the report
   then prints every file as NOT IN THE V3 BUNDLE, a 0/0 self-check, and exit 0:
   a confident, entirely wrong answer, which is the exact failure mode this
   script is written against. Refuse instead. */
if (browserFiles && !fns.size) {
  console.error(
    `${browserFiles} browser captures, but no sourcemapped bundle to position them against.\n` +
      "dist/ is the production build. Re-take the pass: npm run verify:v3-coverage"
  );
  process.exit(1);
}

const allV3 = fs
  .readdirSync(path.join(ROOT, "src", "v3"), { recursive: true })
  .filter((f) => String(f).endsWith(".js"))
  .map((f) => `${V3_REL}${String(f).split(path.sep).join("/")}`)
  .sort();

const byFile = new Map(allV3.map((f) => [f, []]));
for (const fn of fns.values()) {
  if (!byFile.has(fn.file)) byFile.set(fn.file, []);
  byFile.get(fn.file).push(fn);
}

const rows = [];
for (const [file, list] of [...byFile].sort()) {
  const total = list.length;
  const hit = list.filter((f) => f.browser || f.node).length;
  const misses = list.filter((f) => !f.browser && !f.node).sort((a, b) => a.line - b.line);

  /* DEAD LINES — the metric that survives V8's lazy compilation. Every line
     inside a never-entered function is dead, including the nested functions V8
     never compiled and therefore never reported. Counting the SPAN rather than
     the functions is what stops an untouched file from looking small. */
  const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/);
  const isCode = (n) => {
    const l = lines[n - 1];
    return l !== undefined && l.trim() && !/^\s*(\/\/|\/\*|\*)/.test(l);
  };
  const code = lines.filter((_, i) => isCode(i + 1)).length;
  /* Intersect with code lines: a dead span carries the blank lines and the
     comments inside it, and counting those produced 123 dead of 110. */
  const dead = new Set();
  for (const m of misses) for (let l = m.line; l <= m.endLine; l++) if (isCode(l)) dead.add(l);

  rows.push({
    file,
    total,
    hit,
    pct: total ? Math.round((hit / total) * 100) : null,
    dead: dead.size,
    code,
    browserOnly: list.filter((f) => f.browser && !f.node).length,
    nodeOnly: list.filter((f) => f.node && !f.browser).length,
    misses
  });
}

const observed = rows.filter((r) => r.total > 0);
const totalFns = observed.reduce((n, r) => n + r.total, 0);
const totalHit = observed.reduce((n, r) => n + r.hit, 0);

console.log(`\nV3 RUNTIME COVERAGE — ${browserFiles} browser captures, ${nodeFiles} node dumps\n`);
console.log(
  `sourcemap self-check: ${mapCheck.hit}/${mapCheck.hit + mapCheck.miss} named functions ` +
    `land on a source line containing their own name ` +
    `(${Math.round((mapCheck.hit / (mapCheck.hit + mapCheck.miss)) * 100)}%)`
);
for (const e of [...mapCheck.examples].slice(0, 8)) console.log(`  miss: ${e}`);
console.log(
  nodeOrphans.size
    ? `⚠ ${nodeOrphans.size} names ran in node with no browser position: ${[...nodeOrphans].slice(0, 6).join(", ")}`
    : "node/browser merge: every name node executed has a browser position"
);

console.log("\nfile                                  fns  exec    %   dead/code  browser-only  node-only");
for (const r of rows) {
  if (!r.total) {
    console.log(`${r.file.padEnd(36)}    —     —    —   NOT IN THE V3 BUNDLE`);
    continue;
  }
  console.log(
    `${r.file.padEnd(36)}${String(r.total).padStart(5)}${String(r.hit).padStart(6)}` +
      `${String(r.pct).padStart(5)}%${`${r.dead}/${r.code}`.padStart(12)}` +
      `${String(r.browserOnly).padStart(9)}${String(r.nodeOnly).padStart(11)}`
  );
}
const totalDead = observed.reduce((n, r) => n + r.dead, 0);
const totalCode = observed.reduce((n, r) => n + r.code, 0);
console.log(
  `\nTOTAL ${totalHit}/${totalFns} functions executed (${Math.round((totalHit / totalFns) * 100)}%)` +
    ` · ${totalDead}/${totalCode} code lines never ran (${Math.round((totalDead / totalCode) * 100)}% dead)\n`
);

console.log("NEVER EXECUTED\n");
for (const r of rows) {
  if (!r.misses.length) continue;
  console.log(`  ${r.file}`);
  for (const m of r.misses) {
    console.log(
      `    ${`${m.line}-${m.endLine}`.padStart(9)}  col${String(m.col).padEnd(4)} n=${String(m.seen).padEnd(4)} ${(m.name || "(anonymous)").padEnd(22)}` +
        `${sourceLine(m.file, m.line).slice(0, 70)}`
    );
  }
  console.log("");
}

fs.writeFileSync(
  path.join(ROOT, "coverage", "v3-coverage.json"),
  JSON.stringify({ generated: new Date().toISOString(), rows, totalFns, totalHit }, null, 2)
);
