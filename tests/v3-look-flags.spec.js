import { test, expect } from "@playwright/test";

/* Three look flags from the 2026-11-12 visual audit (phase 4): v3SubjectField,
   v3HourWeight, v3ForecastTint. Each is one CSS rule off a root marker main.js
   stamps. Pinned BOTH ways whatever config.js says, and each test also checks
   the place the rule must NOT reach. */

const WEEK = { days: [1, 2, 3].map((d) => ({ date: `2026-08-1${5 + d}`, high_c: 21, low_c: 12, condition: { code: 1, label: "Mostly clear" }, rain_chance_pct: 40 })) };

async function boot(page, on) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    const pins = ["v3SubjectField", "v3HourWeight", "v3ForecastTint"].map((f) => `window.CONFIG.features.${f} = ${on};`).join("\n");
    await route.fulfill({ response: res, body: `${await res.text()}\n${pins}\n` });
  });
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname.startsWith("/api/weather/forecast")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(WEEK) });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.clock.setFixedTime(new Date("2026-08-16T02:00:00Z"));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function" && typeof window.__setDepth === "function");
  expect(await page.evaluate(() => window.CONFIG.features.v3SubjectField)).toBe(on);
  return pageErrors;
}

const photoOpacity = (page) => page.evaluate(() => getComputedStyle(document.querySelector(".photo")).opacity);

for (const on of [true, false]) {
  const state = on ? "ON" : "OFF";

  test(`v3SubjectField ${state}: the photograph ${on ? "gives depths 2 and 3 to the field" : "stays under every depth"}; depth 1 always keeps it`, async ({ page }) => {
    const pageErrors = await boot(page, on);
    expect(await page.evaluate(() => document.documentElement.dataset.subjectField ?? null)).toBe(on ? "1" : null);
    expect(await page.locator(".photo").count()).toBe(1);
    for (const [depth, want] of [[1, "1"], [2, on ? "0" : "1"], [3, on ? "0" : "1"], [0, "1"]]) {
      await page.evaluate((d) => window.__setDepth(d, "spec"), depth);
      expect(await page.evaluate(() => window.__depth().depth)).toBe(depth);
      await expect.poll(() => photoOpacity(page), { message: `depth ${depth}` }).toBe(want);
    }
    expect(pageErrors).toEqual([]);
  });

  test(`v3HourWeight ${state}: the hour is ${on ? "300 over the journey's photograph, 200 everywhere else" : "200 everywhere"}`, async ({ page }) => {
    await boot(page, on);
    const weight = (journey, depth) => page.evaluate(([j, d]) => {
      const root = document.documentElement;
      if (j) root.dataset.journey = "1"; else delete root.dataset.journey;
      window.__setDepth(d, "spec");
      const hour = document.getElementById("hour");
      return { text: hour.textContent, weight: getComputedStyle(hour).fontWeight };
    }, [journey, depth]);
    const over = await weight(true, 0);
    expect(over.text).toMatch(/^\d{1,2}:\d{2}$/);
    expect(over.weight).toBe(on ? "300" : "200");
    expect((await weight(false, 0)).weight).toBe("200");    // the field: never heavier
    expect((await weight(true, 1)).weight).toBe("200");     // the glance: the hour is a small readout
  });

  test(`v3ForecastTint ${state}: the week's icons are ${on ? "pulled toward the palette" : "in full colour"}`, async ({ page }) => {
    await boot(page, on);
    const icons = await page.evaluate(async () => {
      await window.__v3Subject("show.forecast");
      return [...document.querySelectorAll("#subject-mount .subject__dayicon")].map((n) => {
        const cs = getComputedStyle(n);
        return { filter: cs.filter, opacity: cs.opacity };
      });
    });
    expect(icons.length).toBe(3);
    for (const i of icons) {
      expect(i.filter).toBe(on ? "saturate(0.55)" : "none");
      expect(i.opacity).toBe(on ? "0.88" : "1");
    }
  });
}
