#!/usr/bin/env node
/**
 * The bulk lane: send a mountain of text to the LOCAL model and get back the
 * one paragraph that mattered. Nothing here ever enters a Claude context.
 *
 *   npm test 2>&1 | node scripts/xbulk.mjs --task "list only the failing specs and their assertions"
 *   node scripts/xbulk.mjs --file server.log --task "every distinct error, with counts"
 *   ssh pi-dashboard 'journalctl -u dashboard -n 2000' | node scripts/xbulk.mjs --task "what broke, and when"
 *
 * -- What this is for, and what it is NOT for -------------------------------
 * This is a DISTILLER, not a reasoner. Give it jobs where the output is huge
 * and the answer is small: test logs, journalctl dumps, CDP traces, a sweep of
 * "which files mention X". A ~20-30B local model is good at that and it is
 * free and unlimited, which is exactly the trade you want on this lane.
 *
 * Do NOT give it judgement calls. It does not review code, it does not decide
 * whether a flag is safe, and its output is EVIDENCE to be checked, never a
 * verdict to be acted on. That is `/xreview`'s job, on a stronger model.
 *
 * -- Why map-reduce ---------------------------------------------------------
 * A local model's context is small (8-32k) and a real `npm test` run across 101
 * specs is far bigger. Truncating would silently drop the failures at the end,
 * which is the exact failure mode that makes a tool worse than useless — you
 * would trust a clean report that never saw half the input. So oversized input
 * is chunked, each chunk distilled, then the distillations combined. Slower,
 * but it cannot silently lose the tail.
 *
 * -- Requires ---------------------------------------------------------------
 * LM Studio's local server, which speaks the OpenAI API on 127.0.0.1:1234:
 *     lms server start
 * No API key, no quota, no network. If it is not running, this says so.
 */

import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const TASK = arg('task');
const FILE = arg('file');
const HOST = arg('host', process.env.LMSTUDIO_HOST || 'http://127.0.0.1:1234');
let MODEL = arg('model');
// Characters, not tokens — deliberately conservative (~4 chars/token) so a
// chunk plus the instructions still clears a 16k-context model with room spare.
const CHUNK = Number(arg('chunk', '24000'));

if (!TASK) {
  console.error('usage: xbulk --task "<what to extract>" [--file <path>] [--model <id>]');
  console.error('       (input comes from stdin if --file is omitted)');
  process.exit(2);
}

const die = (m) => { console.error(`xbulk: ${m}`); process.exit(1); };

// -- Input ------------------------------------------------------------------
const readStdin = () =>
  new Promise((res) => {
    if (process.stdin.isTTY) return res('');
    let b = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { b += d; });
    process.stdin.on('end', () => res(b));
  });

const raw = FILE ? readFileSync(FILE, 'utf8') : await readStdin();
const text = raw.replace(/\[[0-9;]*m/g, '').trim();   // strip ANSI, logs are full of it
if (!text) die('no input (pipe something in, or pass --file)');

// -- Server ------------------------------------------------------------------
const api = async (path, body) => {
  let r;
  try {
    r = await fetch(`${HOST}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    die(`cannot reach LM Studio at ${HOST}.\n  Start it with:  lms server start\n  (${e.message})`);
  }
  if (!r.ok) die(`LM Studio returned ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
};

if (!MODEL) {
  const list = await api('/v1/models');
  MODEL = list?.data?.[0]?.id;
  if (!MODEL) die('LM Studio is running but has no model loaded. Load one in the app, or:  lms load <model>');
}

const ask = async (system, user) => {
  const j = await api('/v1/chat/completions', {
    model: MODEL,
    temperature: 0,          // distillation, not creativity
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return (j?.choices?.[0]?.message?.content || '').trim();
};

// -- The brief ---------------------------------------------------------------
const SYSTEM = [
  'You extract requested information from raw logs and command output. You are a filter, not an analyst.',
  '',
  'Rules:',
  '- Answer ONLY what was asked. No preamble, no summary of the input, no advice.',
  '- Quote exact identifiers: file paths, line numbers, error strings, counts. Never paraphrase an error message.',
  '- If the answer is not present in the text, say exactly: NOT PRESENT IN INPUT. Never guess and never infer.',
  '- Do not speculate about causes. You are reporting what the text says, nothing more.',
  '- Be terse. A list beats a paragraph.',
].join('\n');

// -- Run ---------------------------------------------------------------------
const chunks = [];
for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));

const t0 = Date.now();
console.error(`xbulk: ${(text.length / 1024).toFixed(1)} KiB in ${chunks.length} chunk(s), model ${MODEL}`);

let answer;
if (chunks.length === 1) {
  answer = await ask(SYSTEM, `TASK: ${TASK}\n\n--- INPUT ---\n${chunks[0]}`);
} else {
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    process.stderr.write(`xbulk: chunk ${i + 1}/${chunks.length}\r`);
    parts.push(await ask(
      SYSTEM,
      `TASK: ${TASK}\n\nThis is part ${i + 1} of ${chunks.length} of a larger log. Extract only what this part contains. If it contains nothing relevant, reply exactly: NONE\n\n--- INPUT ---\n${chunks[i]}`,
    ));
  }
  process.stderr.write('\n');
  const kept = parts.filter((p) => p && !/^NONE$/i.test(p.trim()));
  if (!kept.length) { console.log('NOT PRESENT IN INPUT'); process.exit(0); }
  answer = await ask(
    SYSTEM,
    `TASK: ${TASK}\n\nBelow are partial answers extracted from consecutive slices of one log. Merge them into a single answer: drop duplicates, keep every distinct item, preserve exact identifiers. Do not add anything that is not in the parts.\n\n--- PARTS ---\n${kept.join('\n\n---\n\n')}`,
  );
}

console.error(`xbulk: ${((Date.now() - t0) / 1000).toFixed(0)}s, 0 Claude tokens, 0 cost\n`);
console.log(answer || 'NOT PRESENT IN INPUT');
