import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";
import { RING_EVERY_MS, RING_TIMES, MAX_TIMERS, LATE_RING_MS } from "../src/v3/core/timer-words.js";
import { CHIME_MS } from "../src/v3/core/chime.js";

/* ═══════════════════════════════════════════════════════════════════════════
   VOICE TIMERS ON THE SURFACE THAT SHIPS (features.voiceTimers).

   What each test would catch, stated so /inject-defect has a target:
   - flag off: the lane must not claim the sentence, and nothing is armed.
   - a set timer paints the pill with its NAME and a countdown (text asserted,
     not a count — an empty pill passes every visibility check).
   - it RINGS: said out loud (the TTS body is read, not a call count), repeated
     RING_TIMES, then lets go — and the 1 s interval is gone with it.
   - "stop" while ringing silences the repeats; bare "stop" with nothing
     ringing is NOT ours and must fall through.
   - cancel tears the interval down; a reload restores a live timer.

   The clock is pinned to midday Brisbane so the screensaver and the briefing
   window cannot take the surface while a timer is running.
   ═══════════════════════════════════════════════════════════════════════════ */

test.use({ timezoneId: "Australia/Brisbane" });
const MIDDAY = new Date("2026-07-06T02:00:00Z"); // 12:00 Mon 6 Jul, Brisbane

async function boot(page, { on = true, chime = false } = {}) {
  await page.clock.install({ time: MIDDAY });
  const { pageErrors } = await bootV3(page, {}, { features: { voiceTimers: on, voiceTimerChime: chime } });
  await page.waitForFunction(() => typeof window.__v3Transcript === "function" && !!window.__v3Timers);
  /* Registered AFTER bootV3's catch-all, so it wins (last-registered first).
     Answered 503 so speak() fails fast; the BODY is what the house tried to say. */
  const said = [];
  await page.route("**/api/tts/speak", async (route) => {
    try { said.push(JSON.parse(route.request().postData() ?? "{}").text ?? ""); } catch { said.push(""); }
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  return { pageErrors, said };
}

const snap = (page) => page.evaluate(() => window.__v3Timers.snapshot());

/* clock.install() lets time keep flowing in real time, which is fine for a
   2-minute timer and not for asserting inside a 1 s chime: a few polls of real
   time would carry the page past it. Freeze it, so only runFor moves time. */
async function freezeClock(page) {
  const t = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(t + 1);
}
const transcript = (page, text) => page.evaluate((t) => window.__v3Transcript(t), text);

test("flag off: the lane does not claim a timer and nothing is armed", async ({ page }) => {
  const { pageErrors } = await boot(page, { on: false });
  const result = await transcript(page, "set a pasta timer for 12 minutes");
  expect(result.lane).not.toBe("local");
  const s = await snap(page);
  expect(s.enabled).toBe(false);
  expect(s.live).toEqual([]);
  expect(s.ticking).toBe(false);
  await expect(page.locator("#timers")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("v3.timers"))).toBeNull();
  expect(pageErrors).toEqual([]);
});

test("a set timer paints its name and a countdown in the top-right pill", async ({ page }) => {
  const { pageErrors, said } = await boot(page);
  const result = await transcript(page, "set a pasta timer for 12 minutes");
  expect(result).toMatchObject({ handled: true, lane: "local" });
  expect(said).toContain("Pasta, 12 minutes.");

  const s = await snap(page);
  expect(s.live).toHaveLength(1);
  expect(s.live[0]).toMatchObject({ kind: "timer", label: "pasta" });
  expect(s.ticking).toBe(true);

  const pill = page.locator("#timers");
  /* The corner is the transcript's while "set a pasta timer…" is on the glass,
     so the pill yields first and takes the corner once the readout lingers off
     (voice.js LINGER_MS, 8 s). Both halves asserted: a pill that never yielded
     would overprint the transcript. */
  await expect(page.locator("#heard")).toBeVisible();
  await expect(pill).toBeHidden();
  await page.clock.runFor(9_000);
  await expect(page.locator("#heard")).toBeHidden();
  await expect(pill).toBeVisible();
  await expect(page.locator("#timers-label")).toHaveText("pasta");
  await expect(page.locator("#timers-time")).toHaveText(/^1[12]:\d\d$/);

  // The countdown MOVES — a pill frozen at its first paint would pass the above.
  await page.clock.runFor(61_000);
  await expect(page.locator("#timers-time")).toHaveText(/^10:\d\d$/);

  // Top-right: its right edge sits at the safe inset, on the right half.
  const box = await pill.boundingBox();
  const vw = page.viewportSize().width;
  expect(box.height).toBeGreaterThan(20);
  expect(box.x).toBeGreaterThan(vw / 2);
  expect(box.y).toBeLessThan(200);
  expect(pageErrors).toEqual([]);
});

test("it rings out loud, repeats, then lets go and stops ticking", async ({ page }) => {
  const { pageErrors, said } = await boot(page);
  await transcript(page, "set a timer for 2 minutes for the rice");
  said.length = 0;

  await page.clock.runFor(2 * 60_000 + 500);
  await expect.poll(() => said.filter((t) => t === "The rice timer's done.").length).toBe(1);
  await expect(page.locator("#timers")).toHaveAttribute("data-ringing", "1");
  await expect(page.locator("#timers-time")).toHaveText("Done");

  for (let n = 2; n <= RING_TIMES; n++) {
    await page.clock.runFor(RING_EVERY_MS);
    await expect.poll(() => said.filter((t) => t === "The rice timer's done.").length).toBe(n);
  }
  // After the last repeat, one more interval and it settles — never a fourth.
  await page.clock.runFor(RING_EVERY_MS + 500);
  await expect(page.locator("#timers")).toBeHidden();
  const s = await snap(page);
  expect(s.ringing).toEqual([]);
  expect(s.ticking, "the 1 s interval outlived the last timer").toBe(false);
  expect(said.filter((t) => t === "The rice timer's done.").length).toBe(RING_TIMES);
  // Chime flag off: no ding was scheduled, and the line above came without waiting for one.
  expect(s.chime).toBe(false);
  expect(s.chimes).toBe(0);
  expect(pageErrors).toEqual([]);
});

/* features.voiceTimerChime. What would go wrong, and what catches it:
   - no chime at all → `chimes` stays 0 (counted only once notes are SCHEDULED
     on a real AudioContext, not when the function is merely called);
   - the chime replaces the line instead of preceding it → the line never lands;
   - the line does not wait for the chime → it lands before CHIME_MS elapses;
   - repeats go silent → `chimes` stops at 1;
   - "stop" during the ding still lets the words through → the silenced test. */
test("chime on: a ding precedes every 'Timer's done', and the words wait for it", async ({ page }) => {
  const { pageErrors, said } = await boot(page, { chime: true });
  await freezeClock(page);
  await transcript(page, "set a timer for 1 minute");
  said.length = 0;
  expect((await snap(page)).chime).toBe(true);

  await page.clock.runFor(60_000 + 50);
  await expect.poll(async () => (await snap(page)).chimes).toBe(1);
  // Mid-chime: the words have NOT been said yet.
  await page.clock.runFor(CHIME_MS / 2);
  expect(said.filter((t) => t === "Timer's done.").length, "spoke over the chime").toBe(0);
  await page.clock.runFor(CHIME_MS);
  await expect.poll(() => said.filter((t) => t === "Timer's done.").length).toBe(1);

  for (let n = 2; n <= RING_TIMES; n++) {
    await page.clock.runFor(RING_EVERY_MS);
    await expect.poll(async () => (await snap(page)).chimes).toBe(n);
    await page.clock.runFor(CHIME_MS + 50);
    await expect.poll(() => said.filter((t) => t === "Timer's done.").length).toBe(n);
  }
  expect(pageErrors).toEqual([]);
});

test("chime on: 'stop' during the ding silences the words too", async ({ page }) => {
  const { pageErrors, said } = await boot(page, { chime: true });
  await freezeClock(page);
  await transcript(page, "set a timer for 1 minute");
  said.length = 0;
  await page.clock.runFor(60_000 + 50);
  await expect.poll(async () => (await snap(page)).chimes).toBe(1);

  const stopped = await transcript(page, "stop");
  expect(stopped).toMatchObject({ handled: true, lane: "local" });
  await page.clock.runFor(CHIME_MS + RING_EVERY_MS * RING_TIMES);
  expect(said.filter((t) => t === "Timer's done.").length, "spoke after stop").toBe(0);
  expect((await snap(page)).chimes, "chimed again after stop").toBe(1);
  expect(pageErrors).toEqual([]);
});

test("'stop' while ringing silences it; bare 'stop' with nothing ringing is not ours", async ({ page }) => {
  const { pageErrors, said } = await boot(page);

  // Nothing ringing: "stop" belongs to whatever is playing, not to this lane.
  const idle = await transcript(page, "stop");
  expect(idle.lane).not.toBe("local");

  await transcript(page, "set a timer for 1 minute");
  await page.clock.runFor(60_500);
  await expect.poll(() => said.filter((t) => t === "Timer's done.").length).toBe(1);

  const stopped = await transcript(page, "stop");
  expect(stopped).toMatchObject({ handled: true, lane: "local" });
  await expect(page.locator("#timers")).toBeHidden();

  await page.clock.runFor(RING_EVERY_MS * RING_TIMES);
  expect(said.filter((t) => t === "Timer's done.").length, "it kept ringing after stop").toBe(1);
  expect((await snap(page)).ticking).toBe(false);
  expect(pageErrors).toEqual([]);
});

test("cancel tears down the interval; a query reads what is left", async ({ page }) => {
  const { pageErrors, said } = await boot(page);
  await transcript(page, "set a pasta timer for 12 minutes");
  await transcript(page, "how long left");
  expect(said.some((t) => /^1[12] minutes on the pasta timer\.$/.test(t)), said.join(" | ")).toBe(true);

  const result = await transcript(page, "cancel the pasta timer");
  expect(result).toMatchObject({ handled: true, lane: "local" });
  expect(said).toContain("Pasta timer cancelled.");
  const s = await snap(page);
  expect(s.live).toEqual([]);
  expect(s.ticking).toBe(false);
  await expect(page.locator("#timers")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("v3.timers"))).toBeNull();
  expect(pageErrors).toEqual([]);
});

/* ── Teardown, on a page that runs for weeks ─────────────────────────────────
   `ticking` proves the interval variable is null. It cannot prove there is only
   ONE interval, and it cannot prove a cancelled timer's setTimeout was cleared —
   both of which the 2026-09-19 sweep broke without turning anything red. On a
   surface that is reloaded between every test, an orphaned timer is invisible;
   on the wall it is the primary failure mode.
─────────────────────────────────────────────────────────────────────────── */

/* ⚠ WRAPPED AFTER THE BOOT, NOT IN AN addInitScript. `page.clock.install()`
   REPLACES window.setInterval with its own fake, so a wrapper installed before
   navigation is thrown away and the ledger reads 0 for ever — which looks
   exactly like "no interval was leaked". Wrapping the clock's own functions,
   after it has installed them, is what actually counts. */
const countTimers = (page) => page.evaluate(() => {
  window.__liveIntervals = new Set();
  const si = window.setInterval.bind(window);
  const ci = window.clearInterval.bind(window);
  window.setInterval = (...a) => { const h = si(...a); window.__liveIntervals.add(h); return h; };
  window.clearInterval = (h) => { window.__liveIntervals.delete(h); return ci(h); };
});
const liveIntervals = (page) => page.evaluate(() => window.__liveIntervals.size);

test("a cancelled timer does not go off anyway", async ({ page }) => {
  /* The handle is cleared inside the cancel loop. Without that the entry leaves
     `live`, so every readout says it is gone — and then it fires on schedule and
     the house announces a timer nobody has. Nothing asserted the silence. */
  const { pageErrors, said } = await boot(page);
  await transcript(page, "set a pasta timer for 1 minute");
  expect((await snap(page)).live).toHaveLength(1);

  await transcript(page, "cancel the pasta timer");
  const cancelled = await snap(page);
  expect(cancelled.live).toEqual([]);
  said.length = 0;

  // Well past when it would have ended.
  await page.clock.runFor(90_000);
  await page.waitForTimeout(250);

  expect(said, "a cancelled timer still announced itself").toEqual([]);
  const after = await snap(page);
  expect(after.ringing).toEqual([]);
  expect(after.ticking).toBe(false);
  await expect(page.locator("#timers")).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test("there is ever only ONE one-second interval, and the teardown takes it", async ({ page }) => {
  const { pageErrors } = await boot(page);
  await countTimers(page);
  expect((await snap(page)).ticking, "a tick was already running before any timer").toBe(false);

  // Three timers share one tick — a per-timer interval would be three.
  for (const label of ["pasta", "rice", "eggs"]) {
    await transcript(page, `set a ${label} timer for 20 minutes`);
  }
  expect((await snap(page)).live).toHaveLength(3);
  expect((await snap(page)).ticking).toBe(true);
  expect(
    await liveIntervals(page),
    "one interval per timer — the orphaned ones keep firing forever"
  ).toBe(1);

  // And the flag-off teardown takes it back, rather than leaving it behind.
  await page.evaluate(() => window.__v3Timers.reset());
  expect((await snap(page)).ticking).toBe(false);
  expect(await liveIntervals(page), "reset() left the interval running").toBe(0);
  expect(pageErrors).toEqual([]);
});

test("a TTS failure still returns the surface to idle", async ({ page }) => {
  /* speak() is given a two-handler .then precisely so a failure settles the
     phase. With only the success handler the rejection is unhandled and the
     surface stays `phase="speaking"` — the mic stays gated and the house has
     gone quiet without saying why. boot() answers /api/tts/speak with 503, so
     this is the failing path by default; nothing was asserting the recovery. */
  const rejections = [];
  await page.addInitScript(() => {
    window.__rejections = [];
    window.addEventListener("unhandledrejection", (e) => {
      window.__rejections.push(String(e.reason?.message ?? e.reason));
    });
  });
  const { pageErrors } = await boot(page);
  await transcript(page, "set a timer for 1 minute");

  await page.clock.runFor(60_000 + 500);
  await expect.poll(async () => (await snap(page)).ringing.length).toBe(1);

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.phase), { timeout: 10_000 })
    .toBe("idle");

  rejections.push(...await page.evaluate(() => window.__rejections));
  expect(rejections, "a failed speak() rejected with nobody listening").toEqual([]);
  expect(pageErrors).toEqual([]);
});

/* ── The two branches nothing reached ────────────────────────────────────────
   Found by the mutation sweep on 2026-09-19. `MAX_TIMERS` and `LATE_RING_MS`
   appeared in NO spec at all: the ceiling could be raised to 9999 and the
   late-ring window closed to zero with the whole suite still green. Both are
   policy the house acts on unattended, and the second is the branch behind the
   open "it rang 59 s late" question — a branch with a live mystery in it and no
   test on it was the worst combination in the file.
─────────────────────────────────────────────────────────────────────────── */

test("the sixth timer is refused by name, and the five already running survive it", async ({ page }) => {
  const { pageErrors, said } = await boot(page);

  const kinds = ["pasta", "rice", "eggs", "bread", "soup"];
  for (const label of kinds) await transcript(page, `set a ${label} timer for ${MAX_TIMERS + 10} minutes`);
  expect((await snap(page)).live).toHaveLength(MAX_TIMERS);

  said.length = 0;
  await transcript(page, "set a coffee timer for 3 minutes");

  // The refusal is SPOKEN, and it names the cap — a ceiling raised silently
  // would still read as five here if this only counted the timers.
  expect(said.join(" | ")).toMatch(new RegExp(`${MAX_TIMERS} running already`));
  expect(said.join(" | ")).not.toMatch(/Coffee, 3 minutes/);

  const s = await snap(page);
  expect(s.live).toHaveLength(MAX_TIMERS);
  expect(s.live.map((t) => t.label).sort()).toEqual([...kinds].sort());
  expect(pageErrors).toEqual([]);
});

test("a timer that ended during a reload still rings, once, and an old one does not", async ({ page }) => {
  const { pageErrors, said } = await boot(page);

  /* Ended 30 s ago: inside LATE_RING_MS, so it must still mean something. Rung
     ONCE rather than RING_TIMES, because it is already late. */
  await page.evaluate(() => {
    localStorage.setItem("v3.timers", JSON.stringify([
      { kind: "timer", label: "rice", text: null, endsAt: Date.now() - 30_000 }
    ]));
  });
  said.length = 0;
  await page.reload();
  await page.waitForFunction(() => !!window.__v3Timers);

  await expect.poll(() => said.filter((t) => t === "The rice timer's done.").length).toBe(1);
  const late = await snap(page);
  expect(late.live).toEqual([]);
  expect(late.ringing).toHaveLength(1);
  // rung === RING_TIMES means it will not repeat: it entered at RING_TIMES - 1.
  expect(late.ringing[0].rung).toBe(RING_TIMES);

  /* Ended well outside the window. A timer from this morning announcing itself
     at dinner is worse than one that never rings. */
  await page.evaluate((late_ms) => {
    window.__v3Timers.reset?.();
    localStorage.setItem("v3.timers", JSON.stringify([
      { kind: "timer", label: "porridge", text: null, endsAt: Date.now() - (late_ms + 60_000) }
    ]));
  }, LATE_RING_MS);
  said.length = 0;
  await page.reload();
  await page.waitForFunction(() => !!window.__v3Timers);
  await page.waitForTimeout(300);

  const stale = await snap(page);
  expect(said.filter((t) => /porridge/.test(t))).toEqual([]);
  expect(stale.live).toEqual([]);
  expect(stale.ringing).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("a reload restores a live timer from its end time", async ({ page }) => {
  await boot(page);
  await transcript(page, "set a pasta timer for 12 minutes");
  await page.clock.runFor(60_000);

  await page.reload();
  await page.waitForFunction(() => !!window.__v3Timers);
  const s = await snap(page);
  expect(s.live).toHaveLength(1);
  expect(s.live[0].label).toBe("pasta");
  // About eleven minutes left — restored from the END TIME, not restarted at 12.
  expect(s.live[0].remainingMs).toBeLessThan(11.5 * 60_000);
  expect(s.live[0].remainingMs).toBeGreaterThan(10 * 60_000);
  await expect(page.locator("#timers-label")).toHaveText("pasta");
});
