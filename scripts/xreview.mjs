#!/usr/bin/env node
/**
 * Cross-model adversarial review: hand the outgoing diff to Gemini CLI and get
 * back findings from a model that has NOT watched this session reason its way
 * to the change.
 *
 *   node scripts/xreview.mjs                    review origin/main..HEAD
 *   node scripts/xreview.mjs --range HEAD~3..   review a range
 *   node scripts/xreview.mjs --working          review the uncommitted tree
 *   node scripts/xreview.mjs --model <id>       override the model
 *   node scripts/xreview.mjs --quiet            findings only, no stats
 *
 * -- Why this exists --------------------------------------------------------
 * Two separate wins, and they are NOT the same win:
 *
 *   1. TOKENS. Gemini reads the diff, opens callers, greps for the other half
 *      of a contract -- and all of that tool output lands in GEMINI's context
 *      window, on Google's free tier, not in the Claude session's. Only the
 *      findings come back. A review that would cost a Claude session 40-80k
 *      tokens of file reads costs it the size of this script's stdout.
 *   2. ANCHORING. The reviewer that helped write a patch is the worst reviewer
 *      of it -- it already believes the reasoning. This one arrives cold and is
 *      told the diff is guilty until proven otherwise.
 *
 * -- The read-only guarantee ------------------------------------------------
 * `--approval-mode plan` is Gemini CLI's read-only mode: it can read and grep,
 * it CANNOT edit, write, or run commands. That is not politeness, it is the
 * safety property that makes this safe to run against a repo where pushing to
 * main deploys to a live kiosk. Do not swap it for `auto_edit` or `yolo`.
 *
 * -- Why it spawns bundle/gemini.js and not `gemini` -------------------------
 * On Windows the `gemini` shim is a .cmd, and Node refuses to spawn a .cmd
 * without `shell: true` -- which would then put a multi-KB prompt containing
 * quotes and newlines through cmd.exe's parser. Resolving the package's own
 * `bin` entry and running it under `process.execPath` passes every argument as
 * an array element, so nothing is ever parsed by a shell. The diff itself goes
 * in over stdin, never as an argument, for the same reason.
 *
 * Exit codes: 0 = review ran (findings or not). 1 = could not run.
 * Never gate a push on this exit code -- an unreachable free-tier API must not
 * be able to block a deploy. It is advisory by design.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const QUIET = has('quiet');
const MODEL = arg('model');

const say = (...a) => { if (!QUIET) console.error(...a); };
const die = (msg) => { console.error(`xreview: ${msg}`); process.exit(1); };

// -- 1. Resolve the diff ----------------------------------------------------
const git = (args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let range = arg('range');
let label;
if (has('working')) {
  range = null;
  label = 'uncommitted working tree';
} else if (range) {
  label = range;
} else {
  // Default: what a push would actually send. Fall back to the working tree so
  // the command still does something useful on a branch with no upstream.
  const probe = git(['rev-parse', '--verify', '--quiet', 'origin/main']);
  if (probe.status === 0) { range = 'origin/main..HEAD'; label = range; }
  else { label = 'uncommitted working tree'; }
}

const diffArgs = range
  ? ['diff', '--no-color', '-U8', range]
  : ['diff', '--no-color', '-U8', 'HEAD'];
const diffRes = git(diffArgs);
if (diffRes.status !== 0) die(`git ${diffArgs.join(' ')} failed:\n${diffRes.stderr}`);

const diff = (diffRes.stdout || '').trim();
if (!diff) {
  console.log(`xreview: nothing to review (${label} is empty).`);
  process.exit(0);
}

const files = (diff.match(/^diff --git /gm) || []).length;
say(`xreview: ${files} file(s), ${(diff.length / 1024).toFixed(1)} KiB of diff -- ${label}`);

// -- 2. Resolve the Gemini entry point --------------------------------------
const roots = [];
const npmRoot = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (npmRoot.status === 0 && npmRoot.stdout.trim()) roots.push(npmRoot.stdout.trim());
if (process.env.APPDATA) roots.push(join(process.env.APPDATA, 'npm', 'node_modules'));
roots.push('/usr/local/lib/node_modules', '/usr/lib/node_modules');

const entry = roots
  .map((r) => join(r, '@google', 'gemini-cli', 'bundle', 'gemini.js'))
  .find((p) => existsSync(p));

if (!entry) die('Gemini CLI not found. Install it with:  npm install -g @google/gemini-cli');

// -- 3. The brief -----------------------------------------------------------
// Kept deliberately short. The house rules are NOT restated here -- Gemini loads
// AGENTS.md itself (.gemini/settings.json sets context.fileName), and a brief
// that duplicated them would drift from the mirror the moment CLAUDE.md moved.
const BRIEF = [
  'You are reviewing a diff for the kiosk dashboard in this repository. You did not write it and you were not present for the reasoning behind it. Treat it as guilty until proven otherwise.',
  '',
  'You have already loaded AGENTS.md. Those are the house rules and they are the standard you review against -- especially the sections on feature flags, the 24/7 kiosk memory discipline, testing and the pre-push gate, and root-cause discipline.',
  '',
  'You are in read-only mode. Use it: open the files the diff touches, find the CALLERS of anything it changed, and grep for the other half of any contract it moves. A diff that looks fine in isolation and breaks its caller is exactly the class of defect you are here to catch.',
  '',
  'Prioritise, in this order:',
  '1. Correctness bugs that only show up after hours or days of uptime -- leaks, missing teardown, unrevoked object URLs, cleanup that hangs off transitionend/animationend on an element that is display:none most of the time.',
  '2. Anything that would put a secret, a street address, or a coordinate into src/js/config.js or any other file that ships in the public bundle.',
  '3. A feature that is not flag-gated, or a flag whose OFF state is not reachable or not equivalent to the previous behaviour.',
  '4. A change that touches only one of the two frontends (src/js/ incumbent, src/v3/) where the feature demonstrably exists in both.',
  '5. A new server route with no contract test, or a test whose fixture cannot actually produce the defect it claims to catch.',
  '6. Tests that assert a substring where they mean identity, or that would pass against the very defect they were written for.',
  '',
  'Output rules -- obey these exactly:',
  '- Report ONLY findings. No summary of what the diff does, no praise, no restatement of the code.',
  '- One finding per block, in this shape:',
  '  [SEVERITY] path/to/file.js:LINE -- one-line claim',
  '  why it breaks: <the concrete failure -- inputs or elapsed state, then the wrong outcome>',
  '  confidence: high | medium | low',
  '- SEVERITY is BLOCKER, MAJOR or MINOR. BLOCKER means do not push this.',
  '- Order the findings most severe first.',
  '- If you cannot demonstrate a concrete failure, mark it low confidence or drop it. Do not pad.',
  '- If the diff is clean, output exactly: NO FINDINGS',
  '- Hard cap: 12 findings.',
].join('\n');

// -- 4. Run it --------------------------------------------------------------
const geminiArgs = [
  entry,
  '-p', BRIEF,
  '--approval-mode', 'plan',   // read-only. See header.
  '--skip-trust',
  '--output-format', 'json',
];
if (MODEL) geminiArgs.push('--model', MODEL);

say('xreview: asking Gemini (read-only)...');
const t0 = Date.now();
const run = spawnSync(process.execPath, geminiArgs, {
  input: `Here is the diff under review (${label}):\n\n${'```'}diff\n${diff}\n${'```'}\n`,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  cwd: process.cwd(),
});

if (run.error) die(`could not start Gemini: ${run.error.message}`);

// -- 5. Unpack --------------------------------------------------------------
// No jq on this box (it exits 127, which reads as "the file is broken"), so the
// JSON is parsed here, in the script that is already Node.
let parsed = null;
try { parsed = JSON.parse(run.stdout); } catch { /* fall through to raw */ }

const outDir = '.gemini';
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'last-review.json');
writeFileSync(outFile, run.stdout || run.stderr || '', 'utf8');

// Auth failures do not arrive as JSON — Gemini writes them to stderr and exits
// non-zero, so the parse above fails and the real cause is buried in a stack
// trace. Catch it by name and print the one thing that actually fixes it: this
// is a browser OAuth flow, and it cannot happen inside a spawned process.
const NEEDS_LOGIN = /Authentication cancelled|Please set an Auth method|initOauthClient|not authenticated|invalid_grant/i;
const blob = `${run.stdout || ''}\n${run.stderr || ''}`;

if (!parsed || parsed.error) {
  if (NEEDS_LOGIN.test(blob)) {
    console.error('xreview: Gemini is not signed in.');
    console.error('');
    console.error('  Run this once, in your own terminal, and sign in with your Google account:');
    console.error('');
    console.error('      gemini');
    console.error('');
    console.error('  It opens a browser. ~/.gemini/settings.json already selects oauth-personal,');
    console.error('  so there is no auth picker. Sign in, then /quit. The token persists and');
    console.error('  xreview works from then on. A spawned process cannot do this for you.');
    process.exit(1);
  }
  const msg = parsed?.error?.message || JSON.stringify(parsed?.error) || 'no JSON on stdout';
  console.error(`xreview: Gemini failed: ${msg}`);
  console.error(`xreview: full output saved to ${outFile}`);
  process.exit(1);
}

const body = (parsed.response ?? '').trim();
const secs = ((Date.now() - t0) / 1000).toFixed(0);

if (!QUIET) {
  const tok = parsed.stats && parsed.stats.models
    ? Object.values(parsed.stats.models).reduce((n, m) => n + ((m && m.tokens && m.tokens.total) || 0), 0)
    : null;
  say(`xreview: ${secs}s${tok ? `, ~${tok.toLocaleString()} Gemini tokens (0 Claude tokens)` : ''}`);
  say(`xreview: full response saved to ${outFile}\n`);
}

console.log(body || 'NO FINDINGS');
