import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { judge, BURST_SILENCE_MS } = require("../scripts/kiosk/heap-metrics.cjs");

// The soak's liveness tripwire (2026-08-03).
//
// The soak answers "is the page healthy". It did not answer "is the page
// working", and on 2026-08-03 Live Photo motion was dead for sixteen hours while
// every counter it watches stayed flat. `judge()` is the addition that would
// have caught it at the 24 h sample.
//
// It is exercised HERE against synthetic states because in the field it is only
// ever assessable in daylight, in Mode 0, with clips on disk — so waiting for
// the real conditions to find out whether it fires is precisely how
// `kiosk-drive.cjs cycle` stayed a no-op for weeks while printing success.

const CLIPS = { date: "2026-08-03", total: 12, withClip: 10, pending: 0 };

/** A daylight Mode-0 archive with motion on. Overridable per case. */
function archive(motion = {}) {
  return {
    active: true,
    __uptimeMin: 1180,
    photo: "/api/immich/asset/abc/thumb",
    motion: {
      enabled: true,
      night: false,
      reduced: false,
      bursts: 4,
      lastBurstAt: Date.now() - 30_000,
      ...motion
    }
  };
}

test("THE case: daylight, clips on disk, and the page has never burst", () => {
  // 2026-08-03 exactly. Ten clips reachable by curl, zero reachable by the page.
  const v = judge(archive({ bursts: 0, lastBurstAt: null }), CLIPS);
  expect(v.assessable).toBe(true);
  expect(v.faults).toHaveLength(1);
  expect(v.faults[0]).toContain("NO BURST EVER");
  // The fault has to point at the pool, not the burst code — the burst code was
  // provably fine that day, and an hour went into proving it.
  expect(v.faults[0]).toContain("clipSrc");
});

test("a burst that stopped hours ago is a fault too", () => {
  const v = judge(archive({ bursts: 40, lastBurstAt: Date.now() - BURST_SILENCE_MS - 60_000 }), CLIPS);
  expect(v.assessable).toBe(true);
  expect(v.faults[0]).toContain("STALE");
});

test("a healthy afternoon is silent", () => {
  const v = judge(archive(), CLIPS);
  expect(v.assessable).toBe(true);
  expect(v.faults).toEqual([]);
});

// ── The refusals. Each of these is a state where "no bursts" is CORRECT, and a
// check that returned OK — or a fault — would be lying about a different thing.
for (const [name, state] of [
  ["after sunset", { night: true, bursts: 0, lastBurstAt: null }],
  ["under reduced motion", { reduced: true, bursts: 0, lastBurstAt: null }],
  ["with the motion flag off", { enabled: false, bursts: 0, lastBurstAt: null }]
]) {
  test(`refuses to judge ${name}`, () => {
    const v = judge(archive(state), CLIPS);
    expect(v.assessable, `${name} is by-design quiet — judging it is a false positive`).toBe(false);
    expect(v.faults).toEqual([]);
    expect(v.why).toBeTruthy();
  });
}

test("refuses to judge outside Mode 0 — the awake dashboard has no archive", () => {
  const v = judge({ ...archive(), active: false }, CLIPS);
  expect(v.assessable).toBe(false);
  expect(v.faults).toEqual([]);
});

test("no clip on disk is the transcoder's story, not the page's", () => {
  // The page is behaving correctly by showing stills. Blaming it here would send
  // the next session reading burst code instead of the warm pass.
  const v = judge(archive({ bursts: 0, lastBurstAt: null }), { ...CLIPS, withClip: 0 });
  expect(v.assessable).toBe(false);
  expect(v.why).toContain("warm pass");
  expect(v.faults).toEqual([]);
});

test("an unreachable server is not a verdict", () => {
  const v = judge(archive({ bursts: 0, lastBurstAt: null }), null);
  expect(v.assessable).toBe(false);
  expect(v.faults).toEqual([]);
});

test("a missing probe is not a verdict", () => {
  // Flag off, or pointed at something that is not the kiosk page.
  const v = judge(null, CLIPS);
  expect(v.assessable).toBe(false);
  expect(v.faults).toEqual([]);
});

test("not-assessable never carries a fault — the two must not blur", () => {
  // The invariant behind every case above, stated once. "I could not look" must
  // never be able to read as "I looked and it was broken", or the bedtime soak
  // samples (always night, always unassessable) would cry wolf twice a soak and
  // the whole check would be ignored inside a week.
  const states = [
    [archive({ night: true }), CLIPS],
    [archive({ reduced: true }), CLIPS],
    [archive({ enabled: false }), CLIPS],
    [{ ...archive(), active: false }, CLIPS],
    [archive(), { ...CLIPS, withClip: 0 }],
    [archive(), null],
    [null, CLIPS]
  ];
  for (const [a, c] of states) {
    const v = judge(a, c);
    if (!v.assessable) expect(v.faults).toEqual([]);
  }
});
