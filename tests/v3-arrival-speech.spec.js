import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE-MIND S5b — the arrival greeting is spoken only if it won the room
   (docs/design/HOUSE-MIND.md §S5, features.v3ArrivalEarnsSpeech).

   Asserted at the OUTCOME: a synthesis request carrying the greeting, or the
   absence of one. `__v3().arrival.spoken` is read too, but only as the trace
   that the arrival code ran — "no request" on its own is the starting state,
   and passes against a page that never noticed anyone come home.

   Both directions in both flag states. The off state is the rollback, and a
   gate applied unconditionally would pass every "it stays quiet when it lost"
   test while silencing the house with the flag off.
   ═══════════════════════════════════════════════════════════════════════════ */

// Monday midday: the awake view, inside no briefing window.
const MIDDAY = new Date("2026-07-06T12:00:00");
const HOUR = 60 * 60 * 1000;
const GREETING = "Spec's home.";

/* An interrupt above the arrival's 92, so it holds the hero when both are in
   the queue. Forced, which is exempt from the evidence gate. */
const RIVAL = { id: "spec:rival", source: "rival", text: "The rival holds the room", score: 99, interrupt: true, cooldownMs: 0 };

/* S5d's two rivals. A hot camera trigger (72, not stackOnly) sits BELOW the
   arrival, so it never holds the hero; a stale one is stackOnly. */
const HOT_CAMERA = { id: "spec:camera-hot", source: "cameraTrigger", text: "Front gate · Person", score: 72, cooldownMs: 0 };
const STALE_CAMERA = { ...HOT_CAMERA, id: "spec:camera-stale", score: 45, stackOnly: true };

async function boot(page, on, extra = {}) {
  await page.clock.install({ time: MIDDAY });
  const spoken = [];
  page.on("request", (req) => {
    if (!req.url().includes("/api/tts/speak")) return;
    spoken.push(req.postData() ?? "");
  });
  const { pageErrors } = await bootV3(page, {}, { features: { v3ArrivalEarnsSpeech: on, ...extra } });
  await page.waitForFunction(() => typeof window.__v3Arrival === "function" && typeof window.__forceCandidate === "function");
  return { pageErrors, greetings: () => spoken.filter((body) => body.includes(GREETING)) };
}

/** Leave for an hour, come home. Returns the room as the arrival left it. */
async function arrive(page, { rival }) {
  const cand = rival === true ? RIVAL : rival || null;
  await page.evaluate((cand) => {
    if (cand) { window.__forceCandidate([cand]); window.__v3Tick(); }
    window.__v3Arrival("person.spec", "home");      // the snapshot: already in
    window.__v3Arrival("person.spec", "not_home");  // ...and out
  }, cand);
  await page.clock.setSystemTime(MIDDAY.getTime() + HOUR);
  return page.evaluate(() => {
    window.__v3Arrival("person.spec", "home");
    const v3 = window.__v3();
    return {
      arrival: v3.arrival,
      hero: v3.attention?.hero?.id ?? null,
      announced: v3.announced.map((a) => a.id)
    };
  });
}

for (const on of [true, false]) {
  const state = on ? "ON" : "OFF";

  test(`${state}: an arrival that wins the room is spoken`, async ({ page }) => {
    const { pageErrors, greetings } = await boot(page, on);
    const room = await arrive(page, { rival: false });

    expect(room.hero).toBe("arrival:person.spec");
    expect(room.arrival.text).toBe(GREETING);
    expect(room.arrival.won).toBe(true);
    expect(room.arrival.spoken).toBe(true);
    await expect.poll(() => greetings().length).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  test(`${state}: an arrival that lost the room ${on ? "waits in the queue, unspoken" : "is spoken anyway (as it shipped)"}`, async ({ page }) => {
    const { pageErrors, greetings } = await boot(page, on);
    const room = await arrive(page, { rival: true });

    // The fixture is what is being measured: the rival holds the hero, and the
    // arrival still happened and is still in the queue.
    expect(room.hero).toBe("spec:rival");
    expect(room.announced).toContain("arrival:person.spec");
    expect(room.arrival.text).toBe(GREETING);
    expect(room.arrival.won).toBe(false);
    expect(room.arrival.spoken).toBe(!on);

    if (on) {
      // Long enough for a request to have left; the winning test above is the
      // same-conditions control that one does leave.
      await page.waitForTimeout(400);
      expect(greetings()).toEqual([]);
    } else {
      await expect.poll(() => greetings().length).toBe(1);
    }
    expect(pageErrors).toEqual([]);
  });
}

/* ── HOUSE-MIND S5d (features.v3ArrivalYieldsToCamera) ─────────────────────
   Owner's rule: only a hot camera trigger silences the greeting. S5b stays on,
   as it is live, so every "spoken" here is S5d overriding the hero test. Both
   directions with S5d on, and the hot camera with S5d off as the rollback. */

/** Spoken or not, with the fixture asserted first: the rival really is in the queue. */
async function expectGreeting(page, greetings, room, rivalId, spoken) {
  expect(room.queue).toContain(rivalId);
  expect(room.arrival.text).toBe(GREETING);
  expect(room.arrival.spoken).toBe(spoken);
  if (spoken) {
    await expect.poll(() => greetings().length).toBe(1);
  } else {
    await page.waitForTimeout(400);
    expect(greetings()).toEqual([]);
  }
}

async function arriveWithQueue(page, rival) {
  const room = await arrive(page, { rival });
  room.queue = await page.evaluate(() => (window.__v3().attention?.queue ?? []).map((c) => c.id));
  return room;
}

test("S5d ON: an arrival that lost the hero to a non-camera rival is spoken", async ({ page }) => {
  const { pageErrors, greetings } = await boot(page, true, { v3ArrivalYieldsToCamera: true });
  const room = await arriveWithQueue(page, RIVAL);
  expect(room.hero).toBe("spec:rival");
  expect(room.arrival.won).toBe(false);
  expect(room.arrival.camera).toBe(false);
  await expectGreeting(page, greetings, room, "spec:rival", true);
  expect(pageErrors).toEqual([]);
});

test("S5d ON: a hot camera trigger silences the greeting, though arrival holds the hero", async ({ page }) => {
  const { pageErrors, greetings } = await boot(page, true, { v3ArrivalYieldsToCamera: true });
  const room = await arriveWithQueue(page, HOT_CAMERA);
  expect(room.hero).toBe("arrival:person.spec");
  expect(room.arrival.camera).toBe(true);
  await expectGreeting(page, greetings, room, "spec:camera-hot", false);
  expect(pageErrors).toEqual([]);
});

test("S5d ON: a stale (stack-only) camera trigger does not silence it", async ({ page }) => {
  const { pageErrors, greetings } = await boot(page, true, { v3ArrivalYieldsToCamera: true });
  const room = await arriveWithQueue(page, STALE_CAMERA);
  expect(room.arrival.camera).toBe(false);
  await expectGreeting(page, greetings, room, "spec:camera-stale", true);
  expect(pageErrors).toEqual([]);
});

test("S5d OFF: a hot camera trigger does not silence a greeting that won (S5b as live)", async ({ page }) => {
  const { pageErrors, greetings } = await boot(page, true, { v3ArrivalYieldsToCamera: false });
  const room = await arriveWithQueue(page, HOT_CAMERA);
  expect(room.hero).toBe("arrival:person.spec");
  expect(room.arrival.won).toBe(true);
  await expectGreeting(page, greetings, room, "spec:camera-hot", true);
  expect(pageErrors).toEqual([]);
});
