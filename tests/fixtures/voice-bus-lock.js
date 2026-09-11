/* One test at a time on the voice bus's barge-in channel.

   ── ⚠⚠ A BARGE-IN IN ONE WORKER SILENCES A REPLY IN ANOTHER ─────────────────

   `POST /api/voice/barge-in` emits on `voiceBus`, which is PROCESS-WIDE, and the
   suite shares one server across workers — so every page with an open voice
   stream receives every barge-in and calls tts.silence(). A half-duplex test
   that is waiting for its own reply to start speaking loses it to a barge-in
   posted by another worker's test, and fails with `speaking` never true.

   Root-caused 2026-09-11 after two full-suite sightings (voice-session.spec.js
   2026-09-10, v3-voice.spec.js:267 2026-09-11), both green in isolation.
   Measured on v3-voice.spec.js's barge-in test, --repeat-each=5:
       --workers=1  → 5 passed
       --workers=5  → 4 failed at the same assertion the suite failed on

   Not severable the way tests/fixtures/pin-voice-off.js severs non-voice pages:
   the victims ARE the voice tests, and they need the stream to receive their
   own barge-in. So the tests that post a barge-in, and the tests that assert a
   reply is playing, take this lock and never overlap.

   Usage — in the spec, extend `test` once, then name `voiceBus` in the test's
   fixtures to hold the lock for its whole duration:

       import { test as base, expect } from "@playwright/test";
       import { withVoiceBusLock } from "./fixtures/voice-bus-lock.js";
       const test = withVoiceBusLock(base);
       test("…", async ({ page, request, voiceBus }) => { … });

   ⚠ Any NEW test that posts /api/voice/barge-in or waits on a reply playing
   must name `voiceBus`, or it re-opens this race from the other side.
─────────────────────────────────────────────────────────────────────────── */

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK = join(tmpdir(), "pi-dashboard-voice-bus.lock");
const OWNER = join(LOCK, "pid");
const WAIT_MS = 120_000;
const POLL_MS = 50;

/* A holder killed mid-test (a crashed worker, a Ctrl+C) leaves the directory
   behind. Its pid is the proof it is gone; a missing pid file is only trusted
   as abandoned once it is older than the gap between mkdir and write. */
function abandoned() {
  let pid;
  try {
    pid = Number(readFileSync(OWNER, "utf8"));
  } catch {
    try {
      return Date.now() - statSync(LOCK).mtimeMs > 10_000;
    } catch {
      return false;
    }
  }
  if (!Number.isInteger(pid) || pid <= 0) return true;
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === "ESRCH";
  }
}

async function acquire() {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(OWNER, String(process.pid));
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    if (abandoned()) {
      rmSync(LOCK, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`voice-bus lock not free after ${WAIT_MS} ms (${LOCK}) — is a holder hung?`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export function withVoiceBusLock(base) {
  return base.extend({
    // eslint-disable-next-line no-empty-pattern
    voiceBus: async ({}, use, testInfo) => {
      const asked = Date.now();
      await acquire();
      // Time spent queueing is not the test's to pay for.
      testInfo.setTimeout(testInfo.timeout + (Date.now() - asked));
      try {
        await use(true);
      } finally {
        rmSync(LOCK, { recursive: true, force: true });
      }
    }
  });
}
