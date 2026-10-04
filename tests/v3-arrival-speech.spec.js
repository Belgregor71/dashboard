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

async function boot(page, on) {
  await page.clock.install({ time: MIDDAY });
  const spoken = [];
  page.on("request", (req) => {
    if (!req.url().includes("/api/tts/speak")) return;
    spoken.push(req.postData() ?? "");
  });
  const { pageErrors } = await bootV3(page, {}, { features: { v3ArrivalEarnsSpeech: on } });
  await page.waitForFunction(() => typeof window.__v3Arrival === "function" && typeof window.__forceCandidate === "function");
  return { pageErrors, greetings: () => spoken.filter((body) => body.includes(GREETING)) };
}

/** Leave for an hour, come home. Returns the room as the arrival left it. */
async function arrive(page, { rival }) {
  await page.evaluate((cand) => {
    if (cand) { window.__forceCandidate([cand]); window.__v3Tick(); }
    window.__v3Arrival("person.spec", "home");      // the snapshot: already in
    window.__v3Arrival("person.spec", "not_home");  // ...and out
  }, rival ? RIVAL : null);
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
