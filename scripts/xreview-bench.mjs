#!/usr/bin/env node
/**
 * Score a local model as a code reviewer, against defects with known answers.
 *
 *   node scripts/xreview-bench.mjs                      # the loaded model
 *   node scripts/xreview-bench.mjs --model devstral     # a specific one
 *   node scripts/xreview-bench.mjs --keep               # leave the worktree for inspection
 *
 * -- Why this exists --------------------------------------------------------
 * "Is model X better?" is otherwise answered by reputation, benchmark tables
 * measuring something else, and vibes. None of those predict whether a model
 * will notice that making an exported function `async` silently broke three
 * callers IN THIS repository, under THIS brief, with THESE tools.
 *
 * So: plant defects whose answers are known, run the real reviewer unmodified,
 * and score it. Two cases, because a reviewer can fail in two directions:
 *
 *   RECALL     does it find defects that are really there
 *   PRECISION  does it stay quiet on code that is fine
 *
 * A model that scores 2/2 on recall and invents findings on clean code is worse
 * than useless — every false finding costs a Claude session tokens to
 * adjudicate, which is the opposite of why this lane exists.
 *
 * -- The defects ------------------------------------------------------------
 * D1 is the one that matters. It is INVISIBLE in the diff: the diff shows only
 * screensaver.js, and the damage is in callers the model must go and find. That
 * is the whole argument for giving the reviewer tools, so it is the thing to
 * measure.
 *
 * D2 is deliberately easy and in-diff. It exists to catch a specific failure
 * seen in the wild: a model that finds D1, feels finished, and never opens the
 * second changed file. Scoring D2 separately makes "it stopped early" visible
 * rather than looking like a model that is merely weaker.
 *
 * Everything happens in a git worktree under the scratchpad. The real working
 * tree is never touched — two sessions share it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const KEEP = argv.includes('--keep');
const MODEL = arg('model');
const STEPS = arg('steps', '16');

const REPO = process.cwd();
const REVIEWER = join(REPO, 'scripts', 'xreview-local.mjs');
if (!existsSync(REVIEWER)) { console.error('bench: run me from the repo root'); process.exit(1); }

const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

const BRANCH = `xreview-bench-${Date.now()}`;
const WT = mkdtempSync(join(tmpdir(), 'xrbench-'));

const cleanup = () => {
  if (KEEP) { console.error(`\nbench: worktree kept at ${WT} (branch ${BRANCH})`); return; }
  sh('git', ['worktree', 'remove', '--force', WT], { cwd: REPO });
  sh('git', ['branch', '-D', BRANCH], { cwd: REPO });
  try { rmSync(WT, { recursive: true, force: true }); } catch { /* already gone */ }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// -- Set up ------------------------------------------------------------------
console.error(`bench: worktree ${WT}`);
const add = sh('git', ['worktree', 'add', '-q', '-b', BRANCH, WT, 'HEAD'], { cwd: REPO });
if (add.status !== 0) { console.error(`bench: worktree add failed:\n${add.stderr}`); process.exit(1); }

const runReviewer = (range) => {
  const args = [REVIEWER, '--range', range, '--steps', STEPS];
  if (MODEL) args.push('--model', MODEL);
  const r = sh(process.execPath, args, { cwd: WT });
  return (r.stdout || '') + '\n' + (r.stderr || '');
};

// -- Case 1: RECALL ----------------------------------------------------------
// The file is read and rewritten by regex rather than by exact string: this repo
// is checked out with CRLF endings, and a literal LF-based replace silently
// matches nothing and plants no defect at all — which scores as a model failure
// when in fact the test never ran. Both edits assert they landed.
const plant = (rel, re, replacement, name) => {
  const p = join(WT, rel);
  const src = readFileSync(p, 'utf8');
  if (!re.test(src)) { console.error(`bench: could not plant ${name} — pattern not found in ${rel}`); process.exit(1); }
  writeFileSync(p, src.replace(re, replacement), 'utf8');
};

plant(
  'src/js/modules/screensaver.js',
  /export function isScreensaverActive\(\)\s*\{\s*return active;\s*\}/,
  'export async function isScreensaverActive() {\r\n  await Promise.resolve();\r\n  return active;\r\n}',
  'D1',
);
plant(
  'src/js/config.js',
  /(\n\s*)features:/,
  '$1homeAddress: \'14 Marlowe Street, Wynnum West QLD 4178\',$1features:',
  'D2',
);

sh('git', ['add', '-A'], { cwd: WT });
sh('git', ['commit', '-q', '-m', 'refactor(screensaver): async active check; add home address to config'], { cwd: WT });

console.error('bench: case 1 — two planted defects (this takes minutes)');
const recall = runReviewer('HEAD~1..HEAD');

// Scored on substance, not on the exact wording of a finding. A model that says
// "returns a Promise which is always truthy" and one that says "async breaks the
// boolean check" have both found D1.
const foundD1 = /isScreensaverActive/i.test(recall) && /(async|promise|truthy|await)/i.test(recall);
const foundD2 = /(config\.js|homeAddress)/i.test(recall) && /(address|marlowe|street|public bundle|private location)/i.test(recall);

// -- Case 2: PRECISION -------------------------------------------------------
sh('git', ['reset', '-q', '--hard', 'HEAD~1'], { cwd: WT });
console.error('bench: case 2 — a real, unmodified commit');
const precision = runReviewer('HEAD~1..HEAD');
const quiet = /NO FINDINGS/i.test(precision);

// -- Report ------------------------------------------------------------------
const modelUsed = (recall.match(/xreview-local: ([^\s]+) @ (\d+) ctx/) || [])[1] || MODEL || '(loaded model)';
const secs = (blob) => (blob.match(/xreview-local: (\d+)s/) || [])[1] || '?';

const tick = (b) => (b ? 'PASS' : 'FAIL');
console.log(`
model: ${modelUsed}

  D1  caller-breaking, invisible in the diff   ${tick(foundD1)}
  D2  address in the public bundle, in-diff    ${tick(foundD2)}
  FP  silent on a clean commit                 ${tick(quiet)}

  recall ${[foundD1, foundD2].filter(Boolean).length}/2 · false positives ${quiet ? 'none' : 'YES'} · ${secs(recall)}s + ${secs(precision)}s
`);

if (!foundD1 && !foundD2) {
  console.log('Both misses. Check the run with --keep and read the output before blaming the model —');
  console.log('a reviewer that never converged reports nothing, which looks identical to one that found nothing.');
}
process.exit(foundD1 && foundD2 && quiet ? 0 : 1);
