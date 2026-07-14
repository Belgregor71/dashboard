import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design-system follow-up (docs/design/DESIGN_ROLLOUT.md) — fold the standalone
 * "Now Playing" media panel into the one attention queue.
 *
 * With features.mediaCandidate ON, what's playing surfaces as the lowest low-band
 * attention candidate (source "nowPlaying") and the standalone #media-stack panel
 * is hidden on the presence surface (it stays in the DOM so the candidate + the
 * screensaver line can still read it). OFF (default) is byte-identical: no
 * candidate, the panel shows.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

const MIDDAY = new Date("2026-07-06T12:00:00");

function enableFlags(mediaCandidate) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        "\nwindow.CONFIG.features.presenceRuntime = true;" +
        "\nwindow.CONFIG.features.attentionEngine = true;" +
        // Pin off the other candidate sources so now-playing is the sole candidate
        // (else a fitting seed memory outranks it and this can't assert the hero).
        "\nwindow.CONFIG.features.memoryEngine = false;" +
        "\nwindow.CONFIG.features.predictiveCandidates = false;" +
        "\nwindow.CONFIG.features.foldHomeTiles = false;" +
        `\nwindow.CONFIG.features.mediaCandidate = ${mediaCandidate};\n`;
      await route.fulfill({ response: res, body });
    });
}

// Mark a media player active the way mediaPanels.js does when something plays.
function activateMedia(page) {
  return page.evaluate(() => {
    const p = document.getElementById("media-panel-1");
    p.classList.remove("is-hidden", "is-collapsed");
    p.querySelector(".media-panel__source").textContent = "Lounge Room";
    p.querySelector(".media-panel__title").textContent = "The Parent Trap";
    p.querySelector(".media-panel__image").setAttribute("src", "/media/art/parent-trap.jpg");
  });
}

test("media candidate on: now-playing rides the queue, standalone panel hidden", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__attention === "function");

  await expect(page.locator("body")).toHaveClass(/media-candidate/);

  await activateMedia(page);
  await page.evaluate(() => window.__presence("dwell"));

  // The now-playing candidate surfaces in the ranked queue, source-tagged.
  await expect
    .poll(() => page.evaluate(() => window.__attention().queue.some((c) => c.source === "nowPlaying")))
    .toBe(true);
  const np = await page.evaluate(() => window.__attention().queue.find((c) => c.source === "nowPlaying"));
  expect(np.text).toContain("The Parent Trap");
  expect(np.score).toBeLessThan(42); // lowest low-band
  expect(np.image).toBe("/media/art/parent-trap.jpg"); // carries the artwork
  expect(np.stackOnly).toBe(true); // never the centred hero — a stack card only

  // Stack-only: now-playing is never the hero. As the sole candidate the hero is
  // null (concierge/none), and it rides the DWELL stack with its poster thumbnail.
  await expect.poll(() => page.evaluate(() => window.__attention().hero?.source ?? null)).not.toBe("nowPlaying");
  const stackThumb = await page.evaluate(
    () => document.querySelector("#focus-stack .focus-stack__thumb")?.getAttribute("src") ?? null
  );
  expect(stackThumb).toBe("/media/art/parent-trap.jpg");

  // The standalone panels (media + plex) are hidden on the presence surface.
  const stackDisplay = await page.evaluate(() => getComputedStyle(document.getElementById("media-stack")).display);
  expect(stackDisplay).toBe("none");
  const plexDisplay = await page.evaluate(() => getComputedStyle(document.getElementById("server-status-panel")).display);
  expect(plexDisplay).toBe("none");
  expect(await page.evaluate(() => document.getElementById("media-panel-1") !== null)).toBe(true);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("media candidate off: no now-playing candidate, panel visible (byte-identical)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__attention === "function");

  await expect(page.locator("body")).not.toHaveClass(/media-candidate/);

  await activateMedia(page);
  await page.evaluate(() => window.__presence("dwell"));

  // No now-playing candidate is produced when the flag is off.
  const hasNp = await page.evaluate(() =>
    window.__attention().queue.some((c) => c.source === "nowPlaying")
  );
  expect(hasNp).toBe(false);

  // The panel is not force-hidden (its own is-hidden/is-collapsed still govern it).
  const stackDisplay = await page.evaluate(() => getComputedStyle(document.getElementById("media-stack")).display);
  expect(stackDisplay).not.toBe("none");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
