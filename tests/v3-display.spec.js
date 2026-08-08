import { test, expect } from "@playwright/test";
import { isWithinOffWindow } from "../src/js/services/displayWindow.js";
import { isWithinOffWindow as fromRoute } from "../server/routes/display.js";

/* ═══════════════════════════════════════════════════════════════════════════
   V3 step 5.1 — the panel, and V3 knowing whether it is switched on.

   The step was scoped as "port the energy saver". It is not one, and the specs
   are shaped by the reason: the panel ALREADY goes dark on V3, because DPMS
   belongs to the X display rather than to the URL and the `xset` crontab
   survived the migration. See the header of src/v3/core/display.js.

   So what is worth pinning is not "does the panel turn off" — the crontab does
   that and has for months — but the three things that were actually missing:
   that V3 stops animating when it cannot be seen, that it can ask for the panel
   back when the door goes, and that a broken DPMS cannot trick it into freezing
   a screen that is plainly lit.
   ═══════════════════════════════════════════════════════════════════════════ */

const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/* Windows expressed relative to the real clock, so these specs do not care what
   time the suite runs at. Time-of-day dependence is a documented flake source
   in this repo (CLAUDE.md), and pinning the page clock would not help here —
   the window arithmetic runs on the browser's clock and the stub is built in
   node, so the two have to agree by construction rather than by fixture. */
function windowCovering() {
  const now = Date.now();
  return { start: hhmm(new Date(now - 3600_000)), end: hhmm(new Date(now + 3600_000)) };
}
function windowExcluding() {
  const now = Date.now();
  return { start: hhmm(new Date(now + 3600_000)), end: hhmm(new Date(now + 7200_000)) };
}

/**
 * Boot V3 with the flags and a stubbed display route.
 *
 * `state` is what GET /api/display/state answers — the server is the authority
 * on the window and X is the authority on the monitor, so every interesting
 * case here is a different pair of those two.
 */
async function bootV3(page, { flags = {}, state = null, onWake = null } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) +
      Object.entries(flags).map(([k, v]) => `\nwindow.CONFIG.features.${k} = ${JSON.stringify(v)};`).join("");
    await route.fulfill({ response: res, body });
  });

  /* Cold house — same rule as tests/v3-spread.spec.js.
     ⚠ Registered FIRST, and the order is load-bearing: Playwright checks route
     handlers in REVERSE registration order, so the last one registered wins a
     match. With the catch-all last it swallowed /api/display/state and answered
     503, and every "the panel is dark" case failed while every "the panel is
     lit" case passed — which looks exactly like a broken darkness rule and is a
     broken fixture. */
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );

  if (state) {
    await page.route("**/api/display/state", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state) })
    );
  }
  await page.route("**/api/display/wake", (route) => {
    onWake?.();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ woken: true, holdMs: 90000 })
    });
  });

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

/* ── The shared authority ──────────────────────────────────────────────────
   The route and the browser must not each own a copy of the midnight wrap.
─────────────────────────────────────────────────────────────────────────── */

test("the server and V3 share one off-window, not two copies of it", () => {
  expect(fromRoute).toBe(isWithinOffWindow);
});

test("the window still wraps midnight after the extraction", () => {
  const at = (h, m = 0) => new Date(2026, 6, 30, h, m, 0);
  expect(isWithinOffWindow(at(23, 59), "21:00", "05:00")).toBe(true);
  expect(isWithinOffWindow(at(4, 59), "21:00", "05:00")).toBe(true);
  expect(isWithinOffWindow(at(5, 0), "21:00", "05:00")).toBe(false);
  expect(isWithinOffWindow(at(12, 0), "21:00", "05:00")).toBe(false);
  // Fails towards LIT, which is the direction that cannot freeze a live screen.
  expect(isWithinOffWindow(at(3, 0), "9pm", "5am")).toBe(false);
});

/* ── Flag off ──────────────────────────────────────────────────────────────*/

test("flag off: no timer, no attribute, no handle — the build that shipped before", async ({ page }) => {
  const errors = await bootV3(page, { flags: { v3EnergySaver: false } });

  const seen = await page.evaluate(() => ({
    attr: document.documentElement.dataset.panelDark ?? null,
    handle: typeof window.__v3Display,
    paused: window.__substrate?.().paused ?? null
  }));

  expect(seen.attr).toBeNull();
  expect(seen.handle).toBe("undefined");
  // The substrate must not even know the concept exists while the flag is off.
  expect(seen.paused).toBe(false);
  expect(errors).toEqual([]);
});

/* ── Knowing ───────────────────────────────────────────────────────────────*/

test("outside the off-window the panel is lit and the field keeps moving", async ({ page }) => {
  const errors = await bootV3(page, {
    flags: { v3EnergySaver: true },
    state: { window: windowExcluding(), monitor: "on" }
  });

  await page.evaluate(() => window.__v3DisplayTick());
  const seen = await page.evaluate(() => ({
    dark: window.__v3().display.dark,
    attr: document.documentElement.dataset.panelDark,
    paused: window.__substrate().paused
  }));

  expect(seen.dark).toBe(false);
  expect(seen.attr).toBe("0");
  expect(seen.paused).toBe(false);
  expect(errors).toEqual([]);
});

test("inside the window, with X confirming the monitor is off, the substrate stops", async ({ page }) => {
  const errors = await bootV3(page, {
    flags: { v3EnergySaver: true },
    state: { window: windowCovering(), monitor: "off" }
  });

  await page.evaluate(() => window.__v3DisplayTick());
  const seen = await page.evaluate(() => ({
    dark: window.__v3().display.dark,
    attr: document.documentElement.dataset.panelDark,
    paused: window.__substrate().paused,
    animating: window.__substrate().animating
  }));

  expect(seen.dark).toBe(true);
  expect(seen.attr).toBe("1");
  expect(seen.paused).toBe(true);
  // Paused is the cause; not animating is the thing that costs nothing.
  expect(seen.animating).toBe(false);
  expect(errors).toEqual([]);
});

/* THE fail-safe. The audit records two boot-time actors running `xset -dpms`;
   they are losing today, and that is the only reason the crontab can blank the
   panel at all. If one ever wins, a client that trusted the clock would freeze
   the atmosphere every night on a fully lit 32" panel — which reads as a broken
   dashboard, not as a broken assumption, and would be blamed on V3. */
test("a lit monitor beats the clock — broken DPMS must never freeze a live panel", async ({ page }) => {
  const errors = await bootV3(page, {
    flags: { v3EnergySaver: true },
    state: { window: windowCovering(), monitor: "on" }
  });

  await page.evaluate(() => window.__v3DisplayTick());
  const seen = await page.evaluate(() => ({
    dark: window.__v3().display.dark,
    paused: window.__substrate().paused
  }));

  expect(seen.dark).toBe(false);
  expect(seen.paused).toBe(false);
  expect(errors).toEqual([]);
});

test("no window from the server is never darkness — an unreachable route fails towards lit", async ({ page }) => {
  // No `state` stub at all, so /api/display/state falls through to the 503.
  const errors = await bootV3(page, { flags: { v3EnergySaver: true } });

  await page.evaluate(() => window.__v3DisplayTick());
  const seen = await page.evaluate(() => ({
    dark: window.__v3().display.dark,
    window: window.__v3().display.window,
    paused: window.__substrate().paused
  }));

  expect(seen.window).toBeNull();
  expect(seen.dark).toBe(false);
  expect(seen.paused).toBe(false);
  expect(errors).toEqual([]);
});

test("the field catches up in one frame when the panel comes back", async ({ page }) => {
  const errors = await bootV3(page, {
    flags: { v3EnergySaver: true },
    state: { window: windowCovering(), monitor: "off" }
  });

  await page.evaluate(() => window.__v3DisplayTick());
  const before = await page.evaluate(() => window.__substrate().frames);

  // 05:00, or a wake, or a hand on the keyboard — the surface does not care
  // which, only that it is being looked at again.
  await page.evaluate(() => window.__v3PanelDark(false));
  const after = await page.evaluate(() => window.__substrate());

  expect(after.paused).toBe(false);
  // A night's worth of causes accrued unshown; resuming must draw, not wait for
  // the next 60s pushCauses tick to notice.
  expect(after.frames).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

/* ── Waking ────────────────────────────────────────────────────────────────*/

test("the door asks for the panel when it is dark", async ({ page }) => {
  let wakes = 0;
  const errors = await bootV3(page, {
    flags: { v3EnergySaver: true, displayWake: true },
    state: { window: windowCovering(), monitor: "off" },
    onWake: () => { wakes += 1; }
  });

  await page.evaluate(() => window.__v3DisplayTick());
  expect(await page.evaluate(() => window.__v3().display.dark)).toBe(true);

  await page.evaluate(() => window.__v3Alert("binary_sensor.doorbell_ringing", "on"));

  /* ⚠ Poll the EFFECT, not the request. `wakes` here counts interceptions, and
     the handler runs before the response is fulfilled, let alone parsed — so
     the counter hits 1 while the page has not yet flipped itself back to lit.
     Asserting `dark` off the back of it passed in isolation and failed once
     under full-suite load, which is the same "assert paint, not bookkeeping"
     race this repo has already paid for in ambient-archive.spec.js. */
  await expect.poll(() => page.evaluate(() => window.__v3().display.wakes)).toBe(1);

  // Woken means lit, and lit means the surface is worth drawing again — the
  // hold is the SERVER's number, not a client guess.
  const display = await page.evaluate(() => window.__v3().display);
  expect(display.dark).toBe(false);
  expect(display.litUntil).not.toBeNull();
  expect(wakes).toBe(1);
  expect(errors).toEqual([]);
});

test("a daytime doorbell does not touch the panel at all", async ({ page }) => {
  let wakes = 0;
  const errors = await bootV3(page, {
    flags: { v3EnergySaver: true, displayWake: true },
    state: { window: windowExcluding(), monitor: "on" },
    onWake: () => { wakes += 1; }
  });

  await page.evaluate(() => window.__v3DisplayTick());
  await page.evaluate(() => window.__v3Alert("binary_sensor.doorbell_ringing", "on"));

  // The check is local, so this is not merely "the route said no-op" — no
  // request is made at all.
  await page.waitForTimeout(300);
  expect(wakes).toBe(0);
  expect(errors).toEqual([]);
});

test("displayWake off: V3 may know the panel is dark and still not light it", async ({ page }) => {
  let wakes = 0;
  const errors = await bootV3(page, {
    // The energy saver on, the shared security-event permission OFF. These are
    // two different decisions and the second one is the household's.
    flags: { v3EnergySaver: true, displayWake: false },
    state: { window: windowCovering(), monitor: "off" },
    onWake: () => { wakes += 1; }
  });

  await page.evaluate(() => window.__v3DisplayTick());
  expect(await page.evaluate(() => window.__v3().display.dark)).toBe(true);

  const answer = await page.evaluate(() => window.__v3Wake("spec"));
  expect(answer).toBeNull();
  await page.waitForTimeout(300);
  expect(wakes).toBe(0);
  expect(errors).toEqual([]);
});
