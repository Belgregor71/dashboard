import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";
import { recap, HOMECOMING_MS, QUOTE_MAX } from "../server/services/awayRecap.js";

/* ═══════════════════════════════════════════════════════════════════════════
   "WHILE YOU WERE OUT" — features.v3AwayRecap (field-scan #3 Phase 2).
   The server half is pure and tested in node; the page half is driven through
   a real arrival and asserted at the outcome: the recap request, and the
   candidate the attention engine received. Invented captions only.
   ═══════════════════════════════════════════════════════════════════════════ */

const MIN = 60 * 1000;
const SINCE = Date.parse("2026-07-06T09:00:00");
const UNTIL = Date.parse("2026-07-06T12:00:00");
const at = (minutesAfter) => SINCE + minutesAfter * MIN;
const row = (camera, mins, caption, burst = at(mins)) => ({ at: at(mins), camera, burst, caption });
const LANE_ON = { since: SINCE, until: UNTIL, laneSince: SINCE - MIN };

test.describe("away recap — the summariser", () => {
  test("a tally by camera, front door first, and the front door's latest line quoted", () => {
    const r = recap([
      row("driveway", 10, "A white car is parked in the driveway."),
      row("doorbell", 20, "A person in a hi-vis vest holds a box at the door."),
      row("patio", 30, "A woman waters plants on the patio."),
      row("doorbell", 90, "A man rings the doorbell.")
    ], LANE_ON);
    expect(r.text).toBe("While you were out: someone at the front door twice, someone on the patio and a car in the driveway.");
    expect(r.sub).toMatch(/^Front door, \d{1,2}:\d{2} [ap]m$/);
    expect(r.quote).toBe("A man rings the doorbell.");
    expect(r.events).toBe(4);
    expect(r.last).toBe(at(90));
  });

  test("the last HOMECOMING_MS is the person walking in, and is left out", () => {
    const home = UNTIL - HOMECOMING_MS + MIN;
    const r = recap([
      row("doorbell", 20, "A person at the door."),
      { at: home, camera: "driveway", burst: home, caption: "A car pulls into the driveway." }
    ], LANE_ON);
    expect(r.text).toBe("While you were out: someone at the front door.");
  });

  test("Nothing., negations and rows naming neither are skipped", () => {
    const r = recap([
      row("driveway", 10, "Nothing."),
      row("patio", 11, "No person is visible on the patio."),
      row("backyard", 12, "A cat crosses the lawn."),
      row("doorbell", 13, "A person at the door.")
    ], LANE_ON);
    expect(r.text).toBe("While you were out: someone at the front door.");
    expect(r.events).toBe(1);
  });

  test("rows of one burst count once; a camera with no place is left out", () => {
    const r = recap([
      row("doorbell", 10, "A person at the door.", at(10)),
      row("doorbell", 11, "A person waves at the door.", at(10)),
      row("tilt_pan", 12, "A person in the hall.")
    ], LANE_ON);
    expect(r.text).toBe("While you were out: someone at the front door.");
    expect(r.quote).toBe("A person waves at the door.");
  });

  test("nothing seen: 'All quiet' only when the lane watched the whole absence", () => {
    expect(recap([row("driveway", 10, "Nothing.")], LANE_ON)).toEqual({ text: "All quiet while you were out.", sub: null, quote: null, events: 0, last: null });
    expect(recap([], { ...LANE_ON, laneSince: null })).toBeNull();
    expect(recap([], { ...LANE_ON, laneSince: SINCE + MIN })).toBeNull();
  });

  test("vehicles only: a tally with no quote", () => {
    const r = recap([row("driveway", 10, "A truck reverses up the driveway.")], LANE_ON);
    expect(r.text).toBe("While you were out: a car in the driveway.");
    expect(r.sub).toBeNull();
    expect(r.quote).toBeNull();
  });

  test("at most three places, and a long caption is cut on a word", () => {
    const long = "A person in a very long coat " + "walks slowly past the gate and ".repeat(5) + "leaves.";
    const r = recap([
      row("doorbell", 1, "A person at the door."), row("front_yard", 2, "A child in the front yard."),
      row("patio", 3, "A man on the patio."), row("backyard", 4, long)
    ], LANE_ON);
    expect(r.text).toBe("While you were out: someone at the front door, someone in the front yard and someone on the patio.");
    const quoted = recap([row("backyard", 4, long)], LANE_ON).quote;
    expect(quoted.endsWith("…")).toBe(true);
    expect(quoted.length).toBeLessThanOrEqual(QUOTE_MAX + 1);
  });

  test("an empty or inverted window says nothing", () => {
    expect(recap([row("doorbell", 1, "A person.")], { since: UNTIL, until: SINCE, laneSince: 0 })).toBeNull();
    expect(recap([row("doorbell", 1, "A person.")], { since: NaN, until: UNTIL, laneSince: 0 })).toBeNull();
  });
});

test.describe("away recap — the route", () => {
  test("GET /api/camera-captions/recap: 400 without since, 200 { recap } with it", async ({ request }) => {
    const bad = await request.get("/api/camera-captions/recap");
    expect(bad.status()).toBe(400);
    const ok = await request.get(`/api/camera-captions/recap?since=${Date.now() - 3_600_000}`);
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body).toHaveProperty("recap");
    if (body.recap !== null) expect(typeof body.recap.text).toBe("string");
  });
});

// Monday midday: the awake view, inside no briefing window.
const MIDDAY = new Date("2026-07-06T12:00:00");
const HOUR = 60 * 60 * 1000;
const RECAP = { text: "While you were out: someone at the front door.", sub: "Front door, 11:02 am", quote: "A spec at the door.", events: 1, last: 0 };

async function boot(page, on, answer = RECAP) {
  await page.clock.install({ time: MIDDAY });
  const asked = [];
  const { pageErrors } = await bootV3(page, {}, { features: { v3AwayRecap: on, v3ArrivalYieldsToCamera: false } });
  // AFTER bootV3: page.route() matches the LAST-registered handler first, and
  // bootV3's own /api catch-all would otherwise answer with the real server.
  await page.route("**/api/camera-captions/recap**", (route) => {
    asked.push(new URL(route.request().url()).searchParams);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ recap: answer }) });
  });
  await page.waitForFunction(() => typeof window.__v3Arrival === "function" && typeof window.__v3AwayRecap === "function");
  return { pageErrors, asked };
}

/** Out for an hour, then home. `others` are already in. */
async function arrive(page, others = []) {
  await page.evaluate((others) => {
    // Into the HA cache, which is what othersHome() reads — not just arrival's map.
    for (const id of others) window.__emitHaState({ entity_id: id, state: "home", attributes: { friendly_name: "Other" } });
    window.__v3Arrival("person.spec", "home");
    window.__v3Arrival("person.spec", "not_home");
  }, others);
  await page.clock.setSystemTime(MIDDAY.getTime() + HOUR);
  await page.evaluate(() => window.__v3Arrival("person.spec", "home"));
}

const announced = (page) => page.evaluate(() => window.__v3().announced.find((a) => a.id === "awayRecap") ?? null);

test.describe("away recap — on the page", () => {
  test("ON: the first one home asks for the hour they were out, and the recap is announced", async ({ page }) => {
    const { pageErrors, asked } = await boot(page, true);
    await arrive(page);
    await expect.poll(() => asked.length).toBe(1);
    // The installed clock keeps running, so to the second: the hour they were out.
    expect(Math.abs(Number(asked[0].get("since")) - MIDDAY.getTime())).toBeLessThan(5000);
    expect(Math.abs(Number(asked[0].get("until")) - (MIDDAY.getTime() + HOUR))).toBeLessThan(5000);
    await expect.poll(() => page.evaluate(() => window.__v3AwayRecap()?.text ?? null)).toBe(RECAP.text);
    const cand = await announced(page);
    expect(cand).not.toBeNull();
    expect(cand.source).toBe("awayRecap");
    expect(cand.score).toBeLessThan(92);   // under the greeting, which holds the glance first
    expect(pageErrors).toEqual([]);
  });

  test("ON: after the greeting the glance shows the tally, the label and the quote on its own line — and drops the quote when the recap goes", async ({ page }) => {
    const { pageErrors } = await boot(page, true);
    await arrive(page);
    await expect.poll(() => page.evaluate(() => window.__v3AwayRecap()?.text ?? null)).toBe(RECAP.text);
    // The greeting (92) holds the glance first; its life is 3 minutes.
    await page.clock.fastForward(4 * 60 * 1000);
    const glance = () => page.evaluate(() => {
      window.__v3Presence(true);
      window.__v3Tick();
      const cell = document.getElementById("glance-cell");
      return {
        hero: window.__v3().attention?.hero?.id ?? null,
        said: document.getElementById("glance-said")?.textContent ?? null,
        label: document.getElementById("glance-measured")?.textContent ?? null,
        quotes: [...cell.querySelectorAll(".cell__quote")].map((n) => n.textContent)
      };
    });
    await expect.poll(async () => (await glance()).hero).toBe("awayRecap");
    const shown = await glance();
    expect(shown.said).toBe(RECAP.text);
    expect(shown.label).toBe(RECAP.sub);
    expect(shown.quotes).toEqual(["“A spec at the door.”"]);   // exactly one, with its words
    // Past the recap's 10-minute life: the quote leaves with it.
    await page.clock.fastForward(11 * 60 * 1000);
    await expect.poll(async () => (await glance()).hero).not.toBe("awayRecap");
    expect((await glance()).quotes).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("ON: someone already in — no recap is asked for", async ({ page }) => {
    const { pageErrors, asked } = await boot(page, true);
    await arrive(page, ["person.other"]);
    // The trace that the arrival ran, so "no request" is not the starting state.
    await expect.poll(() => page.evaluate(() => window.__v3().arrival?.text ?? null)).toContain("already in");
    await page.waitForTimeout(300);
    expect(asked).toHaveLength(0);
    expect(await announced(page)).toBeNull();
    expect(pageErrors).toEqual([]);
  });

  test("ON: the server has nothing to say — no card", async ({ page }) => {
    const { pageErrors, asked } = await boot(page, true, null);
    await arrive(page);
    await expect.poll(() => asked.length).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__v3AwayRecap()?.skipped ?? null)).toBe("nothing to say");
    expect(await announced(page)).toBeNull();
    expect(pageErrors).toEqual([]);
  });

  test("OFF: the same arrival asks for nothing (the rollback)", async ({ page }) => {
    const { pageErrors, asked } = await boot(page, false);
    await arrive(page);
    await expect.poll(() => page.evaluate(() => window.__v3().arrival?.text ?? null)).toBe("Spec's home.");
    await page.waitForTimeout(300);
    expect(asked).toHaveLength(0);
    expect(await announced(page)).toBeNull();
    expect(pageErrors).toEqual([]);
  });
});
