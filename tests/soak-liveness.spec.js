import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { judge, judgeGround, BURST_SILENCE_MS } = require("../scripts/kiosk/heap-metrics.cjs");

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

/* ═══════════════════════════════════════════════════════════════════════════
   THE SAME TRIPWIRE, FOR THE SURFACE THAT IS ACTUALLY ON THE WALL.

   Everything above judges the incumbent's Live Photo motion. **That surface is
   not on the wall any more, and not because a flag is off:** there is no ambient
   archive anywhere in `src/v3/` — one grep across the tree returns a single CSS
   comment — so since the cutover `judge()` has answered "not assessable: the
   archive probe is absent" every single time, on a wall where the thing it names
   cannot exist.

   Which means the liveness half — added *because* a flat-looking soak missed
   sixteen dead hours — has itself been looking at nothing for the whole life of
   V3. The same failure, wearing the cutover's clothes.

   `judgeGround` asks V3's version of the question. On this surface the ground IS
   the screen: one photograph, held all day, the most-looked-at thing in the
   house. If it fails to load, fails to reveal, or stops turning over at the day
   boundary, every counter in the soak still reads perfectly flat.
   ═══════════════════════════════════════════════════════════════════════════ */

const TODAY = "Fri Aug 15 2026";
const POOL = [
  { path: "/api/immich/on-this-day", count: 6 },
  { path: "/api/immich/random?count=2", count: 2 }
];

/** A lit V3 wall with one photograph up and settled. Overridable per case. */
function ground(over = {}) {
  return {
    assetId: "f04f7314-63bc-4168-a11c-ba5ca113a930",
    assetIds: ["f04f7314-63bc-4168-a11c-ba5ca113a930"],
    dayKey: TODAY,
    shown: true,
    layers: 1,
    imgs: 1,
    pair: false,
    inFlight: false,
    __dark: false,
    __todayKey: TODAY,
    __uptimeMin: 1180,
    ...over
  };
}

test("THE V3 case: the server is offering memories and the wall is blank", () => {
  // The V3 analogue of 2026-08-03. Six assets reachable by curl, none on the
  // glass — and on this surface that is not a missing embellishment, it is a
  // blank wall where the photograph is supposed to be.
  const v = judgeGround(ground({ assetId: null, assetIds: [], shown: false }), POOL, TODAY);
  expect(v.assessable).toBe(true);
  expect(v.faults).toHaveLength(1);
  expect(v.faults[0]).toMatch(/NO GROUND/);
});

test("an empty pool is Immich's story, not the page's", () => {
  // Same blank wall, opposite cause. The page is behaving correctly by showing
  // nothing when nothing was offered, and blaming it would send the next reader
  // into ground.js instead of into the warm pass.
  const v = judgeGround(
    ground({ assetId: null, assetIds: [], shown: false }),
    [{ path: "/api/immich/on-this-day", count: 0 }, { path: "/api/immich/random?count=2", count: 0 }],
    TODAY
  );
  expect(v.assessable).toBe(false);
  expect(v.why).toMatch(/look at Immich, not the page/);
  expect(v.faults).toEqual([]);
});

test("loaded but never revealed — the failure no counter can see", () => {
  // The <img> is in the DOM, the heap is flat, the node count is right, and the
  // room is looking at nothing. Only the surface's own account of itself
  // distinguishes this from a healthy wall.
  const v = judgeGround(ground({ shown: false }), POOL, TODAY);
  expect(v.faults.join(" ")).toMatch(/LOADED BUT NOT SHOWN/);
});

test("a mid-flight load is not a fault — it is a photograph arriving", () => {
  // The same two fields as the case above, with `inFlight` true. Judging this as
  // a fault would fire on every rotation and the check would be ignored inside a
  // day, which is the fate of every tripwire that cries wolf.
  const v = judgeGround(ground({ shown: false, inFlight: true }), POOL, TODAY);
  expect(v.faults).toEqual([]);
});

test("the day boundary, finally provable from one sample", () => {
  // awakePhotoDissolve's equivalent question went unproven for weeks because
  // nothing persisted the asset id and the check had to span midnight. The page
  // states its own dayKey, so a stale day is one comparison — and it is the
  // difference between "today's memories" and yesterday's, held all day.
  const v = judgeGround(ground({ dayKey: "Thu Aug 14 2026" }), POOL, TODAY);
  expect(v.faults.join(" ")).toMatch(/STALE DAY/);
});

test("a cross-fade that never cleaned up after itself", () => {
  // Two photographic layers at rest with nothing in flight. `layers` ignores a
  // diptych's right half by design, so this cannot be a pair — it is a settle
  // that never finished, which in this house means a transitionend that never
  // fired.
  const v = judgeGround(ground({ layers: 2 }), POOL, TODAY);
  expect(v.faults.join(" ")).toMatch(/SETTLE STUCK/);
});

test("a diptych is not a leak", () => {
  // The guard on the guard. `layers` stays 1 with a pair up (the second half is
  // data-half=1), and a check that counted imgs instead would call every
  // on-this-day pair a fault. HOST-BASELINES carries the same warning for the
  // soak's own `layers` row.
  const v = judgeGround(ground({ pair: true, imgs: 2, assetIds: ["a", "b"] }), POOL, TODAY);
  expect(v.faults).toEqual([]);
});

test("a dark panel is not assessable — v3EnergySaver draws nothing on purpose", () => {
  // The soak samples are taken at bedtime by design, and with the energy saver
  // on that is now a genuinely dark panel for eight hours. "Nothing is being
  // drawn" is the correct behaviour there, so it must never read as a fault.
  const v = judgeGround(ground({ __dark: true, shown: false, assetId: null }), POOL, TODAY);
  expect(v.assessable).toBe(false);
  expect(v.faults).toEqual([]);
});

test("V3's not-assessable never carries a fault either", () => {
  const states = [
    [null, POOL],
    [ground({ __dark: true }), POOL],
    [ground({ assetId: null }), []],
    [ground({ assetId: null }), [{ path: "/api/immich/on-this-day", count: 0 }]]
  ];
  for (const [g, p] of states) {
    const v = judgeGround(g, p, TODAY);
    if (!v.assessable) expect(v.faults).toEqual([]);
  }
});
