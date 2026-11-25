import { test, expect } from "./fixtures/coverage.js";

/* features.v3CornerClock — the time at depths 2 and 3, bottom-right.

   The hour leaves at depth 2 because `.cell--wide` owns its corner, and depth 2
   is when someone has stopped to dwell (critique 2026-11-25; PRODUCT.md asks for
   "a plain corner clock"). Owner's call: bottom-right at 72px, standing down
   under `triple-footer`, whose side cell owns that corner.

   Every test asserts the node exists and carries the time BEFORE asking where
   it is: a 0-height or absent node satisfies every clearance check
   (CLAUDE.md, "A vacuous assertion is not a test"). */

async function boot(page, on) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({ response: res, body: `${await res.text()}\nwindow.CONFIG.features.v3CornerClock = ${on};\n` });
  });
  await page.clock.setFixedTime(new Date("2026-06-16T12:00:00+10:00"));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

const LOW = (id, text, score) => ({ id: `spec:${id}`, source: id, text, score, cooldownMs: 0 });
// pair-note: two cells, no peer. triple-footer: three, no peer. triple: three, one peer (>= 70).
const PAIR_NOTE = [LOW("weather", "Showers later", 42), LOW("menu", "Chicken fajitas", 40)];
const TRIPLE = [LOW("weather", "Showers later", 72), LOW("commute", "23 min to work", 71), LOW("menu", "Chicken fajitas", 40)];
const TRIPLE_FOOTER = [LOW("weather", "Showers later", 42), LOW("commute", "23 min to work", 41), LOW("menu", "Chicken fajitas", 40)];

function dwell(page, candidates) {
  return page.evaluate((cands) => {
    window.__forceCandidate(cands);
    window.__v3Presence("dwell");
    return window.__v3Tick();
  }, candidates);
}

/** The clock as it stands right now. Callers wait with settle() / a hold, never a
 *  fixed sleep: under a loaded suite the 350ms fade measured 0, 0.38 and 0.65
 *  at 600ms, so a sleep is a race the slower machine loses. */
const readClock = (page) => page.evaluate(() => {
  const clock = document.querySelector(".corner-clock");
  const hour = document.getElementById("hour");
  if (!clock) return null;
  const r = clock.getBoundingClientRect();
  const cs = getComputedStyle(clock);
  const cells = [...document.querySelectorAll("#spread-lattice > .cell")].map((n) => n.getBoundingClientRect());
  const hits = cells.filter((c) => c.width && c.height && !(r.right <= c.left || c.right <= r.left || r.bottom <= c.top || c.bottom <= r.top));
  return {
    text: clock.textContent,
    hourText: hour.textContent,
    /* Shown means visible at the hour's own brightness: with v3SunClock on, the
       clock dims with the sun exactly as #hour does (--clock-dim, 0.7..1), so
       "opacity 1" would fail a correctly dimmed clock — it read 0.654 here. */
    shown: cs.visibility === "visible" && Number(cs.opacity) > 0.3 &&
      Math.abs(Number(cs.opacity) - (document.documentElement.dataset.sunClock !== undefined
        ? Number(getComputedStyle(document.documentElement).getPropertyValue("--clock-dim") || 1)
        : 1)) < 0.05,
    opacity: Number(cs.opacity),
    width: r.width, height: r.height,
    rightGap: Math.round(innerWidth - r.right), bottomGap: Math.round(innerHeight - r.bottom),
    fontSize: cs.fontSize,
    overlapsCell: hits.length,
    template: document.getElementById("spread-lattice").dataset.template ?? null,
    depth: document.documentElement.dataset.depth
  };
});

/** Wait until the clock is fully shown (only ever polled for the END state). */
const settleShown = (page) =>
  expect.poll(async () => (await readClock(page))?.shown ?? null, { timeout: 8000 }).toBe(true);

test("OFF: no corner clock node exists — the flag-off DOM is the one that shipped", async ({ page }) => {
  const errors = await boot(page, false);
  await dwell(page, PAIR_NOTE);
  expect(await page.evaluate(() => document.documentElement.dataset.depth)).toBe("2");
  expect(await page.locator(".corner-clock").count()).toBe(0);
  expect(errors).toEqual([]);
});

for (const [name, cands] of [["pair-note", PAIR_NOTE], ["triple", TRIPLE]]) {
  test(`ON: depth 2 (${name}) shows the time bottom-right, clear of every cell`, async ({ page }) => {
    const errors = await boot(page, true);
    await dwell(page, cands);
    await settleShown(page);
    const got = await readClock(page);
    expect(got, "no corner clock node").not.toBeNull();
    expect(got.depth).toBe("2");
    expect(got.template, "the fixture produced a different template").toBe(name);
    expect(got.hourText).toMatch(/^\d{1,2}:\d{2}$/);
    expect(got.text, "the corner clock disagrees with the hour").toBe(got.hourText);
    expect(got.width, "the clock has no box — a position check on it would be vacuous").toBeGreaterThan(40);
    expect(got.shown, `opacity ${got.opacity}`).toBe(true);
    expect(got.rightGap).toBe(96);
    expect(got.bottomGap).toBe(96);
    expect(got.fontSize).toBe("72px");
    expect(got.overlapsCell, "the clock sits on a spread cell").toBe(0);
    expect(errors).toEqual([]);
  });
}

test("ON: triple-footer owns the bottom-right, so the clock stands down — and comes back when it leaves", async ({ page }) => {
  /* Hidden is the clock's STARTING state, so "it is hidden" alone would pass on
     the first frame against a rule that never gates anything. The same page
     therefore holds the hidden state past a whole fade, then recomposes to a
     template that frees the corner and must see the clock arrive. */
  const errors = await boot(page, true);
  await dwell(page, TRIPLE_FOOTER);
  await page.waitForTimeout(1500);   // longer than the fade it would have taken
  const held = await readClock(page);
  expect(held).not.toBeNull();
  expect(held.depth).toBe("2");
  expect(held.template, "the fixture produced a different template").toBe("triple-footer");
  expect(held.text, "the node exists and is current — it is hidden, not stale").toBe(held.hourText);
  expect(held.opacity, "the clock showed under triple-footer's side cell").toBe(0);

  await dwell(page, PAIR_NOTE);
  await settleShown(page);
  expect((await readClock(page)).template).toBe("pair-note");
  expect(errors).toEqual([]);
});

test("ON: depths 0 and 1 keep the hour bottom-left and no corner clock", async ({ page }) => {
  const errors = await boot(page, true);
  const got = await readClock(page);
  expect(got).not.toBeNull();
  expect(got.depth).toBe("0");
  expect(got.shown).toBe(false);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("hour")).visibility)).toBe("visible");
  expect(errors).toEqual([]);
});

test("ON: a depth-3 subject shows the time bottom-right", async ({ page }) => {
  const errors = await boot(page, true);
  // __v3Subject mounts without changing depth (main.js says why), so the depth
  // is set the way tests/v3-alerts.spec.js sets it.
  const shown = await page.evaluate(async () => {
    const ok = await window.__v3Subject("show.day", {}, { calendar: [] });
    window.__setDepth(3, "spec");
    return ok;
  });
  expect(shown, "the subject did not mount — this tests nothing").toBeTruthy();
  await settleShown(page);
  const got = await readClock(page);
  expect(got).not.toBeNull();
  expect(got.depth).toBe("3");
  expect(got.text).toBe(got.hourText);
  expect(got.rightGap).toBe(96);
  expect(got.bottomGap).toBe(96);
  expect(errors).toEqual([]);
});

test("ON: a full list keeps the clock's column clear — no item runs under the time", async ({ page }) => {
  /* Seen in the stills 2026-11-25: a wrapped link at the bottom of a full list
     ran under the clock. The list keeps the clock (it is where the time is
     wanted, at the fridge) and reserves its column instead. */
  const errors = await boot(page, true);
  const mounted = await page.evaluate(async () => {
    const items = ["Ask the plumber about the hot water system pressure valve and whether the warranty still covers the tempering valve",
      "Milk", "Bread", "Eggs", "https://example.com/a-very-long-unbroken-link-that-has-no-spaces-in-it-at-all"];
    const ok = await window.__v3Subject("show.list", { list: "shopping" }, { todos: { shopping: items } });
    window.__setDepth(3, "spec");
    return Boolean(ok);
  });
  expect(mounted, "the list did not mount").toBe(true);
  await expect.poll(() => page.evaluate(() => document.querySelector("#subject-mount .subject__list")?.dataset.fit ?? null)).not.toBeNull();
  await settleShown(page);
  const got = await page.evaluate(() => {
    const c = document.querySelector(".corner-clock").getBoundingClientRect();
    const texts = [...document.querySelectorAll("#subject-mount .subject__text")];
    const hits = texts.filter((t) => [...t.getClientRects()].some((r) =>
      r.width && r.height && r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top));
    const last = texts.at(-1).getBoundingClientRect();
    return { rows: texts.length, hits: hits.map((t) => t.textContent.slice(0, 30)), lastBottom: last.bottom, clockTop: c.top, clockWidth: c.width };
  });
  expect(got.rows).toBe(5);
  expect(got.clockWidth, "the clock has no box").toBeGreaterThan(40);
  expect(got.lastBottom, "the fixture no longer reaches the clock's band — this tests nothing").toBeGreaterThan(got.clockTop);
  expect(got.hits).toEqual([]);
  expect(errors).toEqual([]);
});

test("ON: a depth-3 subject whose content owns the corner (ahead) holds the clock back — and it returns for one that does not", async ({ page }) => {
  /* Measured live 2026-11-25: the clock sat on ahead's said line, status's line,
     year's caption and the lapse/robot plan. Hidden is the starting state, so
     hold it past a fade, then mount a subject that frees the corner (as above). */
  const errors = await boot(page, true);
  const ahead = await page.evaluate(async () => {
    const ok = await window.__v3Subject("show.ahead", {}, {
      calendar: [{ title: "Dentist", summary: "Dentist", start: "2026-06-18T09:00:00+10:00" }]
    });
    window.__setDepth(3, "spec");
    return ok && document.querySelector("#subject-mount > .subject--ahead") !== null;
  });
  expect(ahead, "ahead did not mount — this tests nothing").toBe(true);
  await page.waitForTimeout(1500);   // longer than the fade it would have taken
  const held = await readClock(page);
  expect(held).not.toBeNull();
  expect(held.depth).toBe("3");
  expect(held.text, "the node exists and is current — it is hidden, not stale").toBe(held.hourText);
  expect(held.opacity, "the clock showed over ahead's content").toBe(0);

  const day = await page.evaluate(async () => {
    const ok = await window.__v3Subject("show.day", {}, { calendar: [] });
    window.__setDepth(3, "spec");
    return ok && document.querySelector("#subject-mount > .subject--calendar") !== null;
  });
  expect(day, "day did not mount").toBe(true);
  await settleShown(page);
  expect(errors).toEqual([]);
});
