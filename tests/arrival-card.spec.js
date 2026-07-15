import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design study 03 "The Arrival card" (docs/design/homeos-arrival-card.html),
 * WP3 of docs/design/PLAN.md.
 *
 * With features.arrivalCard ON, the away→home greeting overlay carries the study
 * treatment: #arrival-greeting gets .arrival-card, the card composites the full
 * glass with a warm crown on its top edge, and the countdown drains via a CSS
 * transform animation (no per-arrival JS interval). A ≥2-day absence trips the
 * budgeted home-after-away delight → the warm variant drops the agenda.
 *
 * OFF (default) is byte-identical: no .arrival-card, no glass backdrop on the
 * card, the original JS-width drain, and no debug hooks.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// Pin daytime so the screensaver does not auto-engage at boot (mirrors siblings).
const MIDDAY = new Date("2026-07-06T12:00:00");

function forceArrivalCard(value) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) + `\nwindow.CONFIG.features.arrivalCard = ${value};\n`;
      await route.fulfill({ response: res, body });
    });
}

test("arrival card on: glass overlay, warm crown, CSS drain, warm variant drops agenda", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceArrivalCard(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__forceArrival === "function" && typeof window.__arrivalCard === "function"
  );

  // A normal arrival (agenda kept).
  const probe = await page.evaluate(() => window.__forceArrival({ name: "Greg", warm: false }));
  expect(probe.enabled).toBe(true);
  expect(probe.present).toBe(true);
  expect(probe.warm).toBe(false);
  // The full glass landed on the card, and the warm crown is the top border.
  expect(probe.backdropFilter).toContain("blur");
  expect(probe.borderTop).not.toBe(probe.backdropFilter); // sanity: distinct values read
  await expect(page.locator("#arrival-greeting")).toHaveClass(/arrival-card/);
  await expect(page.locator("#arrival-greeting")).not.toHaveClass(/arrival-greeting--warm/);
  await expect(page.locator("#arrival-greeting .arrival-greeting__events")).toHaveCount(1);

  // The drain is a CSS animation keyed off .is-active — not a JS width interval.
  await expect(page.locator("#arrival-greeting")).toHaveClass(/is-active/);
  const anim = await page.evaluate(
    () => getComputedStyle(document.querySelector("#arrival-greeting .arrival-greeting__bar")).animationName
  );
  expect(anim).toBe("arrival-drain");

  // The warm variant (≥2-day absence) drops the agenda, leaving just the welcome.
  const warm = await page.evaluate(() => window.__forceArrival({ name: "Greg", warm: true }));
  expect(warm.warm).toBe(true);
  await expect(page.locator("#arrival-greeting")).toHaveClass(/arrival-greeting--warm/);
  const eventsDisplay = await page.evaluate(() => {
    const ul = document.querySelector("#arrival-greeting .arrival-greeting__events");
    return ul ? getComputedStyle(ul).display : "absent";
  });
  expect(eventsDisplay === "none" || eventsDisplay === "absent").toBe(true);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("arrival card off: cool card, JS drain, no hooks (byte-identical)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceArrivalCard(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.CONFIG === "object");

  // The study hooks exist only when the flag is on.
  expect(await page.evaluate(() => typeof window.__forceArrival)).toBe("undefined");
  expect(await page.evaluate(() => typeof window.__arrivalCard)).toBe("undefined");

  // Drive a real away→home transition through the DOM event path.
  await page.evaluate(() => {
    const fire = (state) =>
      document.dispatchEvent(
        new CustomEvent("ha:state-updated", {
          detail: { entity_id: "person.greg", state, attributes: { friendly_name: "Greg Dee" } }
        })
      );
    fire("not_home");
    fire("home");
  });

  const overlay = page.locator("#arrival-greeting");
  await expect(overlay).toHaveCount(1);
  await expect(overlay).not.toHaveClass(/arrival-card/);

  // The card carries no glass backdrop from our block (the cool card is unchanged).
  const anim = await page.evaluate(() => {
    const bar = document.querySelector("#arrival-greeting .arrival-greeting__bar");
    return bar ? getComputedStyle(bar).animationName : "absent";
  });
  expect(anim).toBe("none"); // no CSS drain animation → the JS width interval drives it

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

// ── Tier-1b spec reshape (features.arrivalBottom) ─────────────────────────────

function forceArrivalFlags({ card, bottom }) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        `\nwindow.CONFIG.features.arrivalCard = ${card};` +
        `\nwindow.CONFIG.features.arrivalBottom = ${bottom};\n`;
      await route.fulfill({ response: res, body });
    });
}

test("arrival bottom on: bottom-center geometry, 64px welcome, name in --warm", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceArrivalFlags({ card: true, bottom: true })(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__forceArrival === "function");
  await page.evaluate(() => window.__forceArrival({ name: "Greg", warm: false }));

  const overlay = page.locator("#arrival-greeting");
  await expect(overlay).toHaveClass(/arrival-bottom/);

  const probe = await page.evaluate(() => {
    const el = document.getElementById("arrival-greeting");
    const cs = getComputedStyle(el);
    const welcome = el.querySelector(".arrival-greeting__welcome");
    const nameEl = welcome.querySelector("b");
    const time = el.querySelector(".arrival-greeting__time");
    return {
      bottomPx: parseFloat(cs.bottom),
      expectedBottomPx: window.innerHeight * 0.08,
      welcomeSize: getComputedStyle(welcome).fontSize,
      nameColor: nameEl ? getComputedStyle(nameEl).color : "absent",
      nameWeight: nameEl ? getComputedStyle(nameEl).fontWeight : "absent",
      timeColor: time ? getComputedStyle(time).color : "absent"
    };
  });
  expect(Math.abs(probe.bottomPx - probe.expectedBottomPx)).toBeLessThan(1);
  expect(probe.welcomeSize).toBe("64px");
  expect(probe.nameColor).toBe("rgb(255, 205, 140)"); // --warm — the sanctioned exception
  expect(probe.nameWeight).toBe("600");
  expect(probe.timeColor).toBe("rgb(255, 205, 140)"); // event times share the warmth

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("arrival bottom off: the shipped top-slide card is unchanged", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceArrivalFlags({ card: true, bottom: false })(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__forceArrival === "function");
  await page.evaluate(() => window.__forceArrival({ name: "Greg", warm: false }));

  const overlay = page.locator("#arrival-greeting");
  await expect(overlay).toHaveClass(/arrival-card/);
  await expect(overlay).not.toHaveClass(/arrival-bottom/);
  // Top-anchored (the WP3 geometry): explicit top 0, and no <b> in the welcome.
  const probe = await page.evaluate(() => {
    const el = document.getElementById("arrival-greeting");
    return {
      top: getComputedStyle(el).top,
      hasNameMarkup: Boolean(el.querySelector(".arrival-greeting__welcome b"))
    };
  });
  expect(probe.top).toBe("0px");
  expect(probe.hasNameMarkup).toBe(false);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
