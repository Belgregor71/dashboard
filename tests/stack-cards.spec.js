import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Tier-1a spec upgrade "rich stack cards" (features.stackCards, requires
 * leanInStack) — docs/design/design_handoff_homeos_home §Mode-2.
 *
 * ON: the DWELL stack renders the study card — title/sub column (+ optional
 * right meta block), 48px icon slot, hero-glass on the top card, a severity
 * stripe on interrupt candidates, and a mono "+N more" resting note.
 * OFF (default): the shipped one-line chips, byte-identical.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

const MIDDAY = new Date("2026-07-06T12:00:00");

function enableFlags(stackCards) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        "\nwindow.CONFIG.features.presenceRuntime = true;" +
        "\nwindow.CONFIG.features.attentionEngine = true;" +
        "\nwindow.CONFIG.features.leanInStack = true;" +
        `\nwindow.CONFIG.features.stackCards = ${stackCards};` +
        // The temporal spine (default-on since 2026-08-01) hides #focus-stack — the
        // card type/geometry below would still compute on a display:none node and
        // pass while measuring nothing anyone sees. Pin it off: this spec covers the
        // rollback surface, and that is the honest thing for it to be asserting.
        "\nwindow.CONFIG.features.temporalSpine = false;" +
        // Deterministic queue: no seed memories / predictive rules joining it.
        "\nwindow.CONFIG.features.memoryEngine = false;" +
        "\nwindow.CONFIG.features.predictiveCandidates = false;" +
        // Pin the BOM warnings entity off — a real live warning is an interrupt
        // candidate that would outrank the forced ones (see attention.spec).
        '\nwindow.__DASH_CONFIG__ = Object.assign({}, window.__DASH_CONFIG__,' +
        ' { weather: { bom: { warningsEntityId: "sensor.__no_live_warnings__" } } });\n';
      await route.fulfill({ response: res, body });
    });
}

// Five candidates → hero + 2 rendered cards on DWELL, the rest resting.
function forceQueue(page) {
  return page.evaluate(() => {
    window.__forceCandidate([
      { id: "sc-hero", source: "test", score: 90, icon: "🌧", text: "Hero line", cooldownMs: 0 },
      {
        id: "sc-rich", source: "test", score: 80, icon: "📅", cooldownMs: 0,
        text: "Dentist · Starts in 40 min",
        title: "Dentist", sub: "Starts in 40 min", meta: "2:30", metaLabel: "PM"
      },
      { id: "sc-plain", source: "test", score: 70, icon: "⚠️", text: "Plain fallback line", interrupt: true, cooldownMs: 0 },
      { id: "sc-rest-1", source: "test", score: 60, icon: "🚗", text: "Resting one", cooldownMs: 0 },
      { id: "sc-rest-2", source: "test", score: 55, icon: "🗑", text: "Resting two", cooldownMs: 0 }
    ]);
    window.__presence("ambient");
    window.__presence("dwell");
  });
}

test("stack cards on: rich card, hero-glass top, severity stripe, resting note", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__forceCandidate === "function" && typeof window.__presence === "function"
  );
  await forceQueue(page);

  const stack = page.locator("#focus-stack");
  await expect(stack).toHaveClass(/stack-cards/);
  await expect(page.locator("#focus-stack .focus-stack__item")).toHaveCount(2);

  const probe = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#focus-stack .focus-stack__item")];
    const [top, second] = cards;
    const title = top.querySelector(".focus-stack__title");
    const csTitle = getComputedStyle(title);
    const note = document.querySelector("#focus-stack .focus-stack__note");
    const queue = window.__attention().queue.length;
    return {
      topIsHeroGlass: top.classList.contains("focus-stack__item--hero-glass"),
      topTitle: title.textContent,
      topSub: top.querySelector(".focus-stack__sub")?.textContent ?? null,
      topMeta: top.querySelector(".focus-stack__meta-value")?.textContent ?? null,
      topMetaLabel: top.querySelector(".focus-stack__meta-label")?.textContent ?? null,
      titleSize: csTitle.fontSize,
      titleWeight: csTitle.fontWeight,
      secondIsSevere: second.classList.contains("focus-stack__item--severe"),
      secondStripe: getComputedStyle(second).borderLeft,
      secondTitle: second.querySelector(".focus-stack__title")?.textContent ?? null,
      secondSub: second.querySelector(".focus-stack__sub"),
      noteText: note?.textContent ?? null,
      expectedResting: queue - 1 /* hero */ - cards.length
    };
  });

  expect(probe.topIsHeroGlass).toBe(true);
  expect(probe.topTitle).toBe("Dentist");
  expect(probe.topSub).toBe("Starts in 40 min");
  expect(probe.topMeta).toBe("2:30");
  expect(probe.topMetaLabel).toBe("PM");
  expect(probe.titleSize).toBe("44px");
  expect(probe.titleWeight).toBe("600");

  // The plain candidate renders its text in the title slot (one type system),
  // no sub, and its interrupt flag earns the warn stripe.
  expect(probe.secondTitle).toBe("Plain fallback line");
  expect(probe.secondSub).toBeNull();
  expect(probe.secondIsSevere).toBe(true);
  expect(probe.secondStripe).toContain("3px solid rgb(255, 179, 71)");

  // The resting note counts exactly what the queue holds below the fold.
  expect(probe.expectedResting).toBeGreaterThanOrEqual(2); // our two + any env candidates
  expect(probe.noteText).toBe(
    `+ ${probe.expectedResting} more candidate${probe.expectedResting === 1 ? "" : "s"} resting below the fold`
  );

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("stack cards off (default): one-line chips, no rich elements, no note", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__forceCandidate === "function" && typeof window.__presence === "function"
  );
  await forceQueue(page);

  const stack = page.locator("#focus-stack");
  await expect(stack).not.toHaveClass(/stack-cards/);
  await expect(page.locator("#focus-stack .focus-stack__item")).toHaveCount(2);
  // The shipped chip: a __text span; none of the rich-card elements exist.
  await expect(page.locator("#focus-stack .focus-stack__text")).toHaveCount(2);
  await expect(page.locator("#focus-stack .focus-stack__title")).toHaveCount(0);
  await expect(page.locator("#focus-stack .focus-stack__note")).toHaveCount(0);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
