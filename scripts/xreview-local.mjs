#!/usr/bin/env node
/**
 * The cold reviewer, run entirely on this machine. Same job as scripts/xreview.mjs
 * — a model that did not write the diff and was not present for the reasoning
 * behind it — but against LM Studio instead of a metered API. No account, no
 * quota, no network, nothing leaves the box.
 *
 *   node scripts/xreview-local.mjs                    origin/main..HEAD
 *   node scripts/xreview-local.mjs --working          the uncommitted tree
 *   node scripts/xreview-local.mjs --range HEAD~3..
 *   node scripts/xreview-local.mjs --verbose          show every tool call
 *
 * LM Studio is started and the model loaded automatically if they are not
 * already up (scripts/lib/lmstudio.mjs). Nothing to remember after a reboot.
 *
 * It pins devstral-small-2505, and scripts/xbulk.mjs pins gpt-oss-20b, because
 * the two lanes want different models. Measured on identical tasks: Devstral
 * reviews far better (same 2/2 recall, clean case 135s against 1,700s) and
 * extracts far worse (13/19 against 19/19 on an exact-match sweep). The better
 * reviewer is the worse grepper. `--model` overrides and suppresses the swap.
 *
 * -- Why an agent loop and not one big prompt -------------------------------
 * Handing a model 31 KiB of diff and asking "any bugs?" produces NO FINDINGS in
 * one request, which is what the Gemini flash-lite run did. It reads clean
 * because nothing was ever checked. The defects worth catching here are not
 * visible in the diff at all — they live in the CALLER of the changed function,
 * in the other frontend that still has the old shape, in the spec whose fixture
 * cannot produce the defect it claims to catch. Finding those means opening
 * files, which means tools.
 *
 * That is also why local is viable. Chasing a caller is a MATCHING job, and the
 * measured boundary for this model (see scripts/xbulk.mjs) is that matching is
 * where it is reliable. It is a weaker reviewer than a frontier model; it is
 * not a weaker grepper.
 *
 * -- Read-only is enforced here, not requested ------------------------------
 * Gemini gets `--approval-mode plan`. There is no such flag to lean on locally,
 * so the tools below are the ONLY capabilities the model has: read, search,
 * list. There is no write tool and no shell tool to call, so no prompt can talk
 * it into editing anything. Every path is resolved and confirmed to sit inside
 * the repo before it is opened. Do not add a tool to this list casually — a
 * push here deploys to the live kiosk.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import http from 'node:http';
import { ensureLmStudio } from './lib/lmstudio.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

const VERBOSE = has('verbose');
const HOST = arg('host', process.env.LMSTUDIO_HOST || 'http://127.0.0.1:1234');
const MAX_STEPS = Number(arg('steps', '24'));
let MODEL = arg('model');

const ROOT = resolve(process.cwd());
const die = (m) => { console.error(`xreview-local: ${m}`); process.exit(1); };
const log = (...a) => console.error('  ·', ...a);

// -- 1. The diff -------------------------------------------------------------
const git = (a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let range = arg('range');
let label;
if (has('working')) { range = null; label = 'uncommitted working tree'; }
else if (range) { label = range; }
else if (git(['rev-parse', '--verify', '--quiet', 'origin/main']).status === 0) { range = 'origin/main..HEAD'; label = range; }
else { label = 'uncommitted working tree'; }

const diffArgs = range ? ['diff', '--no-color', '-U8', range] : ['diff', '--no-color', '-U8', 'HEAD'];
const diff = (git(diffArgs).stdout || '').trim();
if (!diff) { console.log(`xreview-local: nothing to review (${label} is empty).`); process.exit(0); }

// -- 2. Transport ------------------------------------------------------------
// node:http for the reason documented in scripts/xbulk.mjs: Node's fetch
// enforces a 300s header timeout that cannot be configured from a core import,
// and it surfaces as a bare "fetch failed" that looks exactly like a dead server.
const api = (path, body) =>
  new Promise((res) => {
    const u = new URL(HOST + path);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: body ? 'POST' : 'GET',
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (r) => {
      let b = ''; r.setEncoding('utf8');
      r.on('data', (d) => { b += d; });
      r.on('end', () => {
        if (r.statusCode >= 400) die(`LM Studio returned ${r.statusCode}: ${b.slice(0, 500)}`);
        try { res(JSON.parse(b)); } catch { die(`LM Studio sent non-JSON: ${b.slice(0, 300)}`); }
      });
    });
    req.on('error', (e) => die(`cannot reach LM Studio at ${HOST}.\n  lms server start\n  (${e.message})`));
    if (payload) req.write(payload);
    req.end();
  });

// Starts the server and loads a model if neither is up — see
// scripts/lib/lmstudio.mjs. A lane that fails after every reboot until someone
// remembers two commands is a lane that stops getting used.
const up = await ensureLmStudio({
  host: HOST,
  preferred: MODEL ? [MODEL] : ['devstral-small-2505', 'gpt-oss-20b'],
  say: (m) => console.error(`  · ${m}`),
});
if (!up) {
  die('could not bring LM Studio up.\n' +
      '  Check it is installed, then:  lms server start\n' +
      '  followed by:  lms load devstral-small-2505 --context-length 32768 --gpu max');
}
const loaded = up.models.filter((m) => m.state === 'loaded' && !/embed/i.test(m.id));
if (!MODEL) MODEL = up.model;
const CTX = loaded.find((m) => m.id === MODEL)?.loaded_context_length ?? up.context ?? 4096;
if (CTX < 16384) {
  die(`${MODEL} is loaded with only ${CTX} tokens of context. A review needs room for the diff\n` +
      `  plus the files it opens. Reload:  lms load ${MODEL} --context-length 32768 --gpu max`);
}

// -- 3. Tools ----------------------------------------------------------------
// Read-only by construction. There is deliberately no write and no shell.
const SKIP = new Set(['node_modules', '.git', 'dist', '.agents', 'coverage', 'test-results', 'playwright-report']);
const MAX_TOOL_CHARS = 6000;   // one tool result must never eat the context

// Every path the model supplies passes through here. A path that resolves
// outside the repo is refused rather than clamped — silently reading a
// different file than the model asked for is worse than an error.
const safe = (p) => {
  if (typeof p !== 'string' || !p.trim()) return null;
  const abs = resolve(ROOT, p.replace(/^[/\\]+/, ''));
  const rel = relative(ROOT, abs);
  // Empty rel means the path IS the root, which is fine for list_dir.
  // Anything starting with '..' escaped the repo and is refused, not clamped.
  return rel.startsWith('..') ? null : abs;
};

const walk = function* (dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, depth + 1);
    else yield full;
  }
};

const clip = (s) => (s.length > MAX_TOOL_CHARS
  ? `${s.slice(0, MAX_TOOL_CHARS)}\n… [truncated at ${MAX_TOOL_CHARS} chars — narrow the request]`
  : s);

const TOOLS = {
  // Aliases are accepted on purpose. Observed: the model calls this with
  // line_start/line_end about as often as start_line/end_line, and reading the
  // wrong range silently is worse than any naming purity — it produced a
  // 123-line read when 400 lines were asked for, with no error anywhere.
  read_file({ path, start_line, end_line, line_start, line_end, from, to }) {
    const abs = safe(path);
    if (!abs) return `refused: "${path}" is outside the repository`;
    if (!existsSync(abs) || !statSync(abs).isFile()) return `not found: ${path}`;
    const lines = readFileSync(abs, 'utf8').split('\n');
    const a = Math.max(1, Number(start_line ?? line_start ?? from) || 1);
    const b = Math.min(lines.length, Number(end_line ?? line_end ?? to) || a + 199);
    return clip(lines.slice(a - 1, b).map((l, i) => `${a + i}\t${l}`).join('\n')) ||
      `${path} is empty`;
  },

  search({ pattern, glob }) {
    let re;
    try { re = new RegExp(pattern, 'i'); } catch (e) { return `bad regex: ${e.message}`; }
    const g = glob ? new RegExp(glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'), 'i') : null;
    const hits = [];
    for (const f of walk(ROOT)) {
      const rel = relative(ROOT, f).split(sep).join('/');
      if (g && !g.test(rel)) continue;
      if (!/\.(js|mjs|cjs|json|css|html|md|sh|yml|yaml)$/i.test(rel)) continue;
      let src;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      if (!re.test(src)) continue;
      src.split('\n').forEach((line, i) => {
        if (re.test(line) && hits.length < 60) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
      });
      if (hits.length >= 60) break;
    }
    return hits.length ? clip(hits.join('\n')) : `no matches for /${pattern}/`;
  },

  list_dir({ path }) {
    const abs = safe(path || '.');
    if (!abs) return `refused: "${path}" is outside the repository`;
    if (!existsSync(abs)) return `not found: ${path}`;
    try {
      return clip(readdirSync(abs, { withFileTypes: true })
        .filter((e) => !SKIP.has(e.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n'));
    } catch (e) { return `error: ${e.message}`; }
  },
};

const SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read lines from a file in the repository. Use this to inspect a caller, a sibling implementation, or a spec.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative path, e.g. src/v3/archive.js' },
          start_line: { type: 'number', description: 'First line (1-based). Default 1.' },
          end_line: { type: 'number', description: 'Last line. Default start+199.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Case-insensitive regex search across the repo source. Returns path:line: text. Use this to find CALLERS of a changed function, or the other half of a contract.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'JavaScript regex, e.g. depthCensus\\(' },
          glob: { type: 'string', description: 'Optional path filter, e.g. tests/* or src/v3/*' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the entries of a directory in the repository.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
];

// -- 4. The brief ------------------------------------------------------------
// AGENTS.md is injected rather than loaded by the runtime: unlike Gemini CLI,
// LM Studio has no notion of a project context file. Falling back to CLAUDE.md
// matters because AGENTS.md is generated and may not exist on a fresh clone.
const houseRules = existsSync(join(ROOT, 'AGENTS.md'))
  ? readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
  : (existsSync(join(ROOT, 'CLAUDE.md')) ? readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8') : '');

const SYSTEM = `You are reviewing a diff for a kiosk dashboard repository. You did not write it and you were not present for the reasoning behind it. Treat it as guilty until proven otherwise.

You have three read-only tools: read_file, search, list_dir. USE THEM. A diff that looks fine in isolation and breaks its caller is the main thing you are here to catch, and you cannot see that from the diff alone. Before you conclude anything, search for the callers of what changed.

Work in this order:
1. Read the diff and LIST every file it touches.
2. For each changed function, constant or route, SEARCH for its other uses.
3. Open the ones that look affected.
4. Only then decide.

Cover EVERY file in the diff before you report. Finding one serious defect is not
a reason to stop — a run that reported the broken caller and never looked at the
second changed file missed a street address added to a publicly shipped config.
Account for each file, then report.

Prioritise:
1. Bugs that appear only after hours or days of uptime — leaks, missing teardown, unrevoked object URLs, cleanup hung off transitionend/animationend on an element that is display:none most of the time.
2. A secret, street address or coordinate placed in a file that ships in the public bundle.
3. A feature that is not flag-gated, or a flag whose OFF state is unreachable or not equivalent to the previous behaviour.
4. A change to only one of the two frontends (src/js/ incumbent, src/v3/) where the feature exists in both.
5. A new server route with no contract test, or a spec whose fixture cannot produce the defect it claims to catch.
6. A test asserting a substring where it means identity.

When you are done investigating, reply with findings ONLY, in this shape:

[SEVERITY] path/to/file.js:LINE — one-line claim
why it breaks: <concrete failure: inputs or elapsed state, then the wrong outcome>
confidence: high | medium | low

SEVERITY is BLOCKER, MAJOR or MINOR. Most severe first. Max 12. No summary of the diff, no praise, no restatement of the code. If you genuinely find nothing after opening the callers, reply exactly: NO FINDINGS

HOUSE RULES you are reviewing against:
${houseRules.slice(0, 12000)}`;

// -- 5. The loop -------------------------------------------------------------
const messages = [
  { role: 'system', content: SYSTEM },
  { role: 'user', content: `Diff under review (${label}):\n\n\`\`\`diff\n${diff}\n\`\`\`\n\nInvestigate, then report findings.` },
];

console.error(`xreview-local: ${(diff.match(/^diff --git /gm) || []).length} file(s), ${(diff.length / 1024).toFixed(1)} KiB — ${label}`);
console.error(`xreview-local: ${MODEL} @ ${CTX} ctx, up to ${MAX_STEPS} steps, read-only\n`);

// gpt-oss speaks the "harmony" format, and when a tool call is malformed the
// raw channel marker leaks into content as plain text — observed outputs include
// `to=functions.read_file?` and a full `<|start|>assistant<|channel|>…` wrapper.
// Accepting either as the review would report a leaked token as the verdict.
const LEAKED = /^\s*(to=functions?\.|<\|(start|channel|message|end)\|>|assistantfinal\b)/i;

const t0 = Date.now();
let answer = '';
let calls = 0;
const evidence = [];

for (let step = 0; step < MAX_STEPS; step++) {
  // The diff (messages[1]) and the brief (messages[0]) are never dropped. Only
  // older tool exchanges are. Losing the diff to a trim would leave the model
  // reviewing from memory, which is precisely how a confident empty review gets
  // produced.
  while (messages.length > 3 && JSON.stringify(messages).length > CTX * 2.6) {
    messages.splice(2, 2);
  }

  const j = await api('/v1/chat/completions', {
    model: MODEL,
    temperature: 0,
    // Low during investigation: the deliberating is what makes each step take
    // ~39s, and choosing the next grep does not need it. The synthesis pass
    // below gets the higher effort, because that is where judgement happens.
    reasoning_effort: 'low',
    max_tokens: 3072,
    tools: SCHEMA,
    messages,
  });

  const m = j?.choices?.[0]?.message;
  if (!m) die('empty response from LM Studio');

  const toolCalls = m.tool_calls || [];
  if (!toolCalls.length && LEAKED.test(m.content || '')) {
    if (VERBOSE) log('malformed tool call leaked into content — retrying the step');
    messages.push({
      role: 'user',
      content: 'That was not a valid tool call. Either call read_file, search or list_dir properly, or give your final findings as plain text now.',
    });
    continue;
  }
  if (!toolCalls.length) {
    // See scripts/xbulk.mjs: a reasoning model can return a 200 with empty
    // content and everything in `reasoning`. Treating that as "no findings"
    // would be the exact lie this lane exists to prevent.
    answer = (m.content || '').trim() || (m.reasoning || '').trim();
    break;
  }

  messages.push({ role: 'assistant', content: m.content || '', tool_calls: toolCalls });
  for (const tc of toolCalls) {
    calls++;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* reported below */ }
    // Tolerant dispatch. The model reaches for plausible names that are not in
    // the schema — `open_file` was called twice in one run — and a bare
    // "unknown tool" reply wastes a whole step and often derails the run. Map
    // the near-misses instead of being right about it.
    const want = String(tc.function.name || '').toLowerCase();
    const ALIAS = {
      open_file: 'read_file', view_file: 'read_file', cat: 'read_file', get_file: 'read_file',
      grep: 'search', find: 'search', search_files: 'search', rg: 'search',
      ls: 'list_dir', list_directory: 'list_dir', list_files: 'list_dir',
    };
    const fn = TOOLS[want] || TOOLS[ALIAS[want]];
    const out = fn ? fn(args) : `unknown tool "${tc.function.name}". Valid tools: read_file, search, list_dir.`;
    if (VERBOSE) log(`${tc.function.name}(${JSON.stringify(args).slice(0, 110)}) -> ${String(out).split('\n').length} line(s)`);
    else process.stderr.write(`\r  · step ${step + 1}/${MAX_STEPS}, ${calls} tool call(s)   `);
    messages.push({ role: 'tool', tool_call_id: tc.id, content: String(out) });
    // Kept separately so the finalisation pass can be rebuilt WITHOUT any
    // tool-call history. See the comment on that pass.
    evidence.push(`${tc.function.name}(${JSON.stringify(args)}):\n${String(out)}`);
  }
}

// A model left to its own devices keeps searching. The first run spent all ten
// steps on genuinely sensible greps and then reported nothing at all, because
// it never decided it was finished. So exhausting the budget is not a failure
// here — it is the cue to stop investigating and answer from what was gathered.
// Without this the tool's most likely output is silence, which reads as "clean".
if (!answer) {
  if (!VERBOSE) process.stderr.write('\r' + ' '.repeat(50) + '\r');
  console.error('  · step budget spent — asking for the verdict on what was gathered');

  // Rebuilt from scratch, with the gathered evidence flattened into ONE user
  // message and no tool history at all. Simply dropping the `tools` parameter
  // from the existing conversation does not work: with tool calls in the
  // history gpt-oss keeps trying to make another, and with no tools declared
  // LM Studio cannot parse it, so the raw harmony wrapper lands in content as
  // text — an observed answer was literally
  //   <|start|>assistant<|channel|>analysis to=functions.search ...
  // A conversation that never mentioned tools does not tempt it.
  const finalMessages = [
    { role: 'system', content: SYSTEM.replace(/You have three read-only tools[\s\S]*?Only then decide\.\n/, '') },
    {
      role: 'user',
      content:
        `Diff under review (${label}):\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n` +
        `You already investigated. Here is everything you gathered:\n\n${evidence.join('\n\n---\n\n').slice(0, CTX * 1.6)}\n\n` +
        `Report your findings now, in the required format, based only on the above. If you genuinely found nothing, reply exactly: NO FINDINGS`,
    },
  ];
  for (let attempt = 0; attempt < 2 && !answer; attempt++) {
    const j = await api('/v1/chat/completions', {
      model: MODEL,
      temperature: 0,
      reasoning_effort: 'medium',   // judgement pass — see the loop above
      max_tokens: 3072,
      messages: finalMessages,
    });
    const m = j?.choices?.[0]?.message || {};
    const cand = (m.content || '').trim() || (m.reasoning || '').trim();
    if (cand && !LEAKED.test(cand)) answer = cand;
    else if (VERBOSE) log('finalisation leaked harmony format — retrying');
  }
}

if (!VERBOSE) process.stderr.write('\r' + ' '.repeat(50) + '\r');
console.error(`xreview-local: ${((Date.now() - t0) / 1000).toFixed(0)}s, ${calls} tool call(s), 0 Claude tokens, 0 cost\n`);

console.log(answer || 'xreview-local: no answer produced — rerun with --verbose to see where it stalled.');
