import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design study 01 "The Ambient memory surface" (ambient half of
 * docs/design/homeos-component-studies.html), WP4 of docs/design/PLAN.md.
 *
 * The tender ambient lane. With features.ambientMemory ON, a tender memory
 * surfaces ONLY in Mode 0 and ONLY wordlessly: its photo fills the frame + a
 * faint 🕯 mark bottom-right, held longer, then the slideshow resumes — never a
 * caption, never the text hero. The render lane also REFUSES any non-tender
 * surface (the render-boundary half of the tender invariant that memory.spec
 * already locks inside memoryEngine.toSurface).
 *
 * OFF (default) is byte-identical: no mark element, no debug hooks, tender
 * memories stay dropped.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// Pin daytime so boot is deterministic (no auto-engage before we drive it).
const MIDDAY = new Date("2026-07-06T12:00:00");

function forceAmbientMemory(value) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        `\nwindow.CONFIG.features.ambientMemory = ${value};` +
        // Pin Immich off so the async photo fetch never delays engage.
        `\nwindow.CONFIG.features.immichPhotos = false;\n`;
      await route.fulfill({ response: res, body });
    });
}

// A tender surface exactly as memoryEngine.toSurface(tenderEntry) shapes it.
const TENDER = {
  id: "memory:brodie",
  source: "memory",
  sensitivity: "tender",
  ambientOnly: true,
  caption: null,
  text: "",
  photos: ["/photos/brodie/by-the-heater.jpg"],
  holdMs: 22000,
  interrupt: false
};
// A normal surface (ambientOnly:false, carries a caption) — the lane must refuse it.
const NORMAL = {
  id: "memory:tas",
  source: "memory",
  sensitivity: "normal",
  ambientOnly: false,
  caption: "On this day — Tasmania.",
  text: "On this day — Tasmania.",
  photos: ["/photos/tasmania/wineglass-bay.jpg"],
  holdMs: 12000
};

test("ambient memory on: a tender memory surfaces wordless, held, and spends the budget", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceAmbientMemory(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__forceAmbientMemory === "function" && typeof window.__ambientMemory === "function"
  );

  // Force the tender surface through the wordless lane.
  const probe = await page.evaluate((s) => window.__forceAmbientMemory(s), TENDER);
  expect(probe.enabled).toBe(true);
  expect(probe.markVisible).toBe(true);   // the 🕯 answered
  expect(probe.markText).toBe("🕯");       // …and it is the ONLY mark — never a caption
  expect(probe.held).toBe(true);          // held (longer than a rotation)
  expect(probe.photo).toContain("brodie"); // the memory's own photo fills the frame

  // Nowhere in the screensaver is the tender memory captioned — the footer/info
  // lines carry no memory text (the photo carries it; we do not narrate grief).
  const captioned = await page.evaluate(() => {
    const txt = document.querySelector("#screensaver .screensaver__content")?.textContent ?? "";
    return /on this day|brodie/i.test(txt);
  });
  expect(captioned).toBe(false);

  // Rarity budget holds: surfacing the memory spent today's budget.
  const spentDay = await page.evaluate(
    () => JSON.parse(localStorage.getItem("dashboard:memory-history") || "{}").lastSurfacedDay ?? null
  );
  expect(spentDay).not.toBeNull();

  // The lane refuses a non-tender surface — it belongs to the text hero, not here.
  const refused = await page.evaluate((s) => window.__forceAmbientMemory(s), NORMAL);
  expect(refused.refused).toBe(true);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("ambient memory off: no mark element, no hooks (byte-identical)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceAmbientMemory(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__engageScreensaver === "function");
  await page.evaluate(() => window.__engageScreensaver());

  await expect(page.locator("#screensaver .screensaver__tender-mark")).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.__ambientMemory)).toBe("undefined");
  expect(await page.evaluate(() => typeof window.__forceAmbientMemory)).toBe("undefined");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
