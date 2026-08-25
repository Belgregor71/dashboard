/**
 * Bring LM Studio up if it is not already, so the local lanes work after a
 * reboot without anyone remembering two commands.
 *
 * -- Why this exists --------------------------------------------------------
 * `lms server start` has no autostart option and the server does not survive a
 * reboot, so without this every local lane fails the first time it is used each
 * day. A tool that needs a remembered incantation before it works is a tool
 * that stops getting used — which is the same reason /xreview is not wired into
 * the pre-push gate.
 *
 * -- Why it loads EXPLICITLY rather than letting LM Studio JIT-load -----------
 * A just-in-time load uses LM Studio's default context of 4096 tokens, even for
 * a model that supports 131,072. That is not enough to hold a diff plus the
 * files a reviewer opens, and the failure is a bare HTTP 400 halfway through a
 * run. So the load here always names the context and the GPU offload.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';

// The `lms` shim is not on PATH by default on Windows — LM Studio installs it
// under the user profile and only its own terminal integration exports it.
const lmsPath = () => {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  for (const p of [
    join(home, '.lmstudio', 'bin', 'lms.exe'),
    join(home, '.lmstudio', 'bin', 'lms'),
    join(home, '.cache', 'lm-studio', 'bin', 'lms'),
  ]) if (existsSync(p)) return p;
  return null;
};

const lms = (args, timeout = 300000) => {
  const bin = lmsPath();
  if (!bin) return { status: 127, stderr: 'lms CLI not found' };
  return spawnSync(bin, args, { encoding: 'utf8', timeout, windowsHide: true });
};

const probe = (host) =>
  new Promise((resolve) => {
    const u = new URL(`${host}/api/v0/models`);
    const req = http.get(
      { hostname: u.hostname, port: u.port, path: u.pathname, timeout: 4000 },
      (r) => {
        let b = '';
        r.setEncoding('utf8');
        r.on('data', (d) => { b += d; });
        r.on('end', () => { try { resolve(JSON.parse(b).data || []); } catch { resolve(null); } });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });

/**
 * Returns the list of models LM Studio knows about, having started the server
 * and loaded a model if needed. Returns null only if it genuinely could not.
 *
 * `preferred` is tried in order; the first one present on disk is loaded.
 */
export async function ensureLmStudio({
  host = 'http://127.0.0.1:1234',
  preferred = ['devstral-small-2505', 'gpt-oss-20b'],
  context = 32768,
  minContext = 16384,
  say = () => {},
} = {}) {
  let models = await probe(host);

  if (models === null) {
    if (!lmsPath()) return null;          // LM Studio not installed — caller reports it
    say('LM Studio is not running — starting it');
    lms(['server', 'start'], 120000);
    for (let i = 0; i < 10 && models === null; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      models = await probe(host);
    }
    if (models === null) return null;
  }

  const isChat = (m) => !/embed/i.test(m.id);
  let loaded = models.filter((m) => m.state === 'loaded' && isChat(m));

  const onDisk = models.filter(isChat).map((m) => m.id);
  const pick = preferred.find((p) => onDisk.includes(p)) || onDisk[0];
  if (!pick) return null;

  // A model loaded with a toy context is worse than none: it fails mid-run with
  // an opaque 400 rather than up front, so it is reloaded rather than accepted.
  //
  // The preference is also enforced, not merely consulted. The two lanes want
  // DIFFERENT models — measured on the same tasks, Devstral reviews far better
  // and extracts far worse (13/19 against gpt-oss's 19/19 on an exact-match
  // sweep) — so accepting whatever happened to be loaded would silently run a
  // lane on the model that is worse at its job. A reload costs about a minute;
  // a quietly wrong answer costs more. Pass `preferred: [x]` to pin one.
  // ONE definition of "this will do", used both to accept what is already up and
  // to decide the load worked. They were separate expressions and disagreed: the
  // post-load check accepted ANY loaded chat model at ANY context, so a lane
  // could return the model this function had just refused two lines earlier.
  const accepts = (m) =>
    m.state === 'loaded' && isChat(m) && m.id === pick
    && (m.loaded_context_length ?? 0) >= minContext;

  const usable = loaded.filter(accepts);
  if (usable.length) return { models, model: usable[0].id, context: usable[0].loaded_context_length };

  if (loaded.length) {
    const why = loaded[0].id === pick
      ? `only ${loaded[0].loaded_context_length} tokens`
      : `the wrong model for this lane`;
    say(`${loaded[0].id} is loaded with ${why} — reloading`);
    lms(['unload', '--all']);
  }
  say(`loading ${pick} at ${context} tokens (first run of the day takes a minute)`);
  // --ttl matters more than it looks. A resident 12 GB model starves the
  // browser's GPU compositing, and the Playwright suite has timing-sensitive
  // browser specs — v3-archive.spec.js:420 allows 500ms for a transition. With
  // a model loaded that spec failed TWICE, reproducibly; with the GPU free the
  // suite went 1559/1559. An idle eviction means the hazard expires on its own
  // instead of depending on someone remembering to unload before npm test.
  const r = lms(['load', pick, '--context-length', String(context), '--gpu', 'max', '--ttl', '1800', '-y'], 600000);
  if (r.status !== 0) return null;

  /* ⚠⚠ THE MODEL IS NOT QUERYABLE THE INSTANT `lms load` RETURNS, and a single
     probe here reported failure on a load that had entirely succeeded. Measured
     2026-08-25: `lms load` exited 0, this probe found nothing, the caller
     printed "could not bring LM Studio up" — and `lms ps` showed the model IDLE
     at 14.33 GB and the full 32768 context the whole time.

     🔑 THE COST WAS NOT THE WASTED RUN. The advice that failure prints is
     "run: lms load ..." — which, with the model already resident, asks for a
     SECOND copy. That trips LM Studio's memory guardrail ("requires
     approximately 22.29 GB") and reads like a machine too small for the lane,
     which is the wrong lesson entirely. A bring-up race that lies in that
     direction costs more than one that simply retries.

     Same shape and same budget as the server-start loop above — 10 x 1.5s. A
     load that has not registered inside fifteen seconds is a real failure. */
  let now = null;
  for (let i = 0; i < 10 && !now; i++) {
    models = await probe(host);
    now = (models || []).find(accepts);
    if (!now) await new Promise((res) => setTimeout(res, 1500));
  }
  return now ? { models, model: now.id, context: now.loaded_context_length } : null;
}
