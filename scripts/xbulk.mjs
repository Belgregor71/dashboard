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
 * -- Measured, 2026-08-23, gpt-oss-20b @ 32k ------------------------------
 * EXACT-MATCH extraction from a log: 19/19 correct in 10s. This is the job.
 * SEMANTIC judgement over a 67 KiB doc with inconsistent markers: 14 of 19,
 * and it dropped an item the document stated in plain English ("F3 is closed").
 *
 * So the boundary is not "big vs small", it is "matching vs judging". Ask it
 * WHICH LINES SAY X and it is reliable. Ask it WHAT COUNTS AS X and it is not.
 * Phrase every task as the former.
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
import http from 'node:http';

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const TASK = arg('task');
const FILE = arg('file');
const HOST = arg('host', process.env.LMSTUDIO_HOST || 'http://127.0.0.1:1234');
let MODEL = arg('model');
// Chunk size is DERIVED from the model's loaded context, not guessed — see
// resolveChunk(). A fixed default is how this broke the first time: LM Studio
// had loaded a 131k-capable model at 4096 tokens, and a hardcoded 24000-char
// chunk simply 400'd. The number that matters is what the model was LOADED
// with, which is not the same as what it supports.
const CHUNK_OVERRIDE = arg('chunk') ? Number(arg('chunk')) : null;

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
// node:http, not fetch. Node's fetch (undici) enforces a 300s headersTimeout
// that is not configurable from a core import, and a 20B model prefilling ~19k
// tokens on partial GPU offload takes longer than that. The failure is
// indistinguishable from the server being down — it surfaces as a bare
// "fetch failed" — which sent this on a false hunt for a crashed server once
// already. Raw http has no such timeout unless one is set, so none is.
const api = (path, body) =>
  new Promise((resolve) => {
    const u = new URL(HOST + path);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: body ? 'POST' : 'GET',
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let b = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { b += d; });
        res.on('end', () => {
          if (res.statusCode >= 400) die(`LM Studio returned ${res.statusCode}: ${b.slice(0, 500)}`);
          try { resolve(JSON.parse(b)); } catch { die(`LM Studio sent non-JSON: ${b.slice(0, 300)}`); }
        });
      },
    );
    req.on('error', (e) =>
      die(`cannot reach LM Studio at ${HOST}.\n  Start it with:  lms server start\n  (${e.message})`));
    if (payload) req.write(payload);
    req.end();
  });

// LM Studio's native API (/api/v0) reports what each model is actually LOADED
// with; the OpenAI-compatible /v1/models does not. That distinction is the whole
// reason this function exists.
const inventory = async () => {
  try {
    const j = await api('/api/v0/models');
    return (j?.data || []).filter((m) => m.state === 'loaded');
  } catch { return []; }
};

const loaded = await inventory();
if (!MODEL) {
  MODEL = loaded.find((m) => !/embed/i.test(m.id))?.id
       || (await api('/v1/models'))?.data?.[0]?.id;
  if (!MODEL) die('LM Studio is running but has no model loaded.\n  Load one with:  lms load <model> --context-length 32768 --gpu max');
}

const ctx = loaded.find((m) => m.id === MODEL)?.loaded_context_length ?? 4096;
// ~2.5 chars/token is pessimistic for prose and logs (real is nearer 4), and
// 4096 tokens are held back for the instructions and the answer. Pessimism is
// correct here: overflowing costs a hard 400 and a wasted pass, while a chunk
// that is slightly too small costs one extra round trip.
const CHUNK = CHUNK_OVERRIDE ?? Math.max(4000, Math.floor((ctx - 4096) * 2.5));
if (ctx <= 8192 && !CHUNK_OVERRIDE) {
  console.error(`xbulk: warning — ${MODEL} is loaded with only ${ctx} tokens of context.`);
  console.error(`  Everything still works (input is map-reduced, never truncated) but it will`);
  console.error(`  take many more passes. Reload bigger:  lms load ${MODEL} --context-length 32768 --gpu max`);
}

const ask = async (system, user) => {
  const j = await api('/v1/chat/completions', {
    model: MODEL,
    temperature: 0,            // distillation, not creativity
    reasoning_effort: 'low',   // see below
    max_tokens: 4096,          // a hard stop on the loop described below
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  const m = j?.choices?.[0]?.message || {};
  // Reasoning models (gpt-oss, qwen3-thinking, deepseek-r1) put their chain of
  // thought in `reasoning` and the answer in `content`. Left at default effort,
  // gpt-oss-20b spent 2,987 tokens deliberating over this exact task, looped
  // ("Also P41? none. Also P42? none."), hit the stop, and returned EMPTY
  // content — a successful 200 with nothing in it. Hence low effort and a token
  // ceiling. If content is still empty the reasoning is all we have, so use it
  // rather than silently reporting nothing: an empty answer here would read as
  // "the log contained nothing", which is the one lie this tool must not tell.
  const content = (m.content || '').trim();
  if (content) return content;
  const reasoning = (m.reasoning || '').trim();
  if (reasoning) {
    console.error('xbulk: warning — model returned reasoning but no final answer; using the reasoning.');
    return reasoning;
  }
  return '';
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
