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

// Rounded: a finished fade can report 1.9e-13 rather than 0.
const photoOpacity = (page) => page.evaluate(() =>
  String(Math.round(parseFloat(getComputedStyle(document.querySelector(".photo")).opacity) * 1000) / 1000));

for (const on of [true, false]) {
  const state = on ? "ON" : "OFF";

  test(`v3SubjectField ${state}: the photograph ${on ? "gives depths 2 and 3 to the field" : "stays under every depth"}; depth 1 always keeps it`, async ({ page }) => {
    const pageErrors = await boot(page, on);
    expect(await page.evaluate(() => document.documentElement.dataset.subjectField ?? null)).toBe(on ? "1" : null);
    expect(await page.locator(".photo").count()).toBe(1);
    for (const [depth, want] of [[1, "1"], [2, on ? "0" : "1"], [3, on ? "0" : "1"], [0, "1"]]) {
      await page.evaluate((d) => window.__setDepth(d, "spec"), depth);
      expect(await page.evaluate(() => window.__depth().depth)).toBe(depth);
      /* ⚠ Wait OUT the fade (--m-calm, 350 ms) and then read once. A poll for
         "1" passes on the first frame of a fade to 0 — two injected defects
         (the rule ignoring its flag; the rule reaching depth 1) stayed green
         that way on 2026-11-12. */
      await page.waitForTimeout(500);
      /* Then poll, never before: past 500 ms a WRONG fade has already reached
         its wrong end, so the poll cannot pass on it. Needed since the field's
         exposure (2026-11-14) draws a frame on the depth change, which under
         the full suite's software GL started the fade late (read 0.008). */
      await expect.poll(() => photoOpacity(page), { message: `depth ${depth}`, timeout: 2000 }).toBe(want);
    }
    expect(pageErrors).toEqual([]);
  });

  /* 2026-11-14: a daytime spread read on the wall as BLACK — the field's envelope
     was set as a dim mat, and the subject field made it the whole backdrop. The
     gain must reach the PIXELS (not just the stat), only at depths 2 and 3, and
     never with the flag off. */
  test(`v3SubjectField ${state}: the field ${on ? "brightens behind a spread and subject" : "draws the same at every depth"}`, async ({ page }) => {
    const pageErrors = await boot(page, on);
    const at = (d) => page.evaluate((depth) => {
      window.__setDepth(depth, "spec");
      const s = window.__substrate();
      // Mid-panel: outside every ink-guard zone (gl.js), so the gain is all that differs.
      const [[r, g, b]] = window.__substrateSample([[0.5, 0.55]]);
      return { depth: window.__depth().depth, backend: s.backend, exposure: s.exposure, lum: r + g + b };
    }, d);
    const field = await at(0);
    expect(field.backend).toBe("webgl2");
    expect(field.depth).toBe(0);
    expect(field.lum, "the field draws something to compare against").toBeGreaterThan(30);
    for (const [depth, gain] of [[1, 1], [2, on ? 2.2 : 1], [3, on ? 2.2 : 1], [0, 1]]) {
      const r = await at(depth);
      expect(r.depth).toBe(depth);
      expect(r.exposure, `exposure at depth ${depth}`).toBe(gain);
      if (gain > 1) expect(r.lum, `pixels at depth ${depth}`).toBeGreaterThan(field.lum * 1.8);
      else expect(Math.abs(r.lum - field.lum), `pixels at depth ${depth}`).toBeLessThan(field.lum * 0.15);
    }
    expect(pageErrors).toEqual([]);
  });

  /* 2026-11-14, the second half of the black spread: the exposure fix was live
     and the wall was STILL black, because a wrapped headline laid the
     photograph's veil (solved at 0.82 for a photo that was hidden) over the
     field. Proven only with a REAL wrapped spread: a bare depth 2 has no veil. */
  test(`v3SubjectField ${state}: a wrapped spread's veil is ${on ? "solved for the field (0.5)" : "the photograph's"}`, async ({ page }) => {
    const pageErrors = await boot(page, on);
    await page.evaluate(() => {
      window.__v3Presence("dwell");
      window.__forceCandidate([
        { id: "w-a", source: "weather", score: 68, text: "Showers, possible storm 15 to 35 mm today", title: "Showers", sub: "", cooldownMs: 0 },
        { id: "w-b", source: "tonightsMenu", score: 55, text: "Prawn fried rice for dinner", title: "Prawn fried rice", sub: "Dinner", cooldownMs: 0 }
      ]);
      window.__v3Tick();
    });
    const wrapped = page.locator(".depth--spread .said[data-wrapped]");
    await expect(wrapped).toHaveCount(1, { timeout: 10_000 });
    await expect(wrapped).toContainText("Showers");
    expect(await page.evaluate(() => window.__depth().depth)).toBe(2);
    // The veil must still EXIST (the small labels need it), at the field's opacity, not the photo's.
    const veil = await page.evaluate(() => {
      const b = getComputedStyle(document.querySelector(".depth--spread"), "::before");
      return { content: b.content, alpha: Number((b.backgroundColor.match(/\/\s*([\d.]+)\)/) || [])[1] ?? NaN),
        photoSolved: Number(getComputedStyle(document.documentElement).getPropertyValue("--scrim-opacity")) };
    });
    expect(veil.content).toBe('""');
    expect(veil.alpha, "the veil's alpha").toBeGreaterThan(0);
    if (on) expect(veil.alpha).toBeCloseTo(0.5, 2);
    else expect(veil.alpha).toBeCloseTo(veil.photoSolved, 2);
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
