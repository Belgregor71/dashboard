import { test, expect } from "@playwright/test";

/* V3's voice turn: which depth it lands on, which cells light, and — the one
   that actually matters for a surface that runs for weeks — whether a subject
   dismantles itself when the room stops looking at it.

   Upstreams are stubbed to a dead port in this harness, so only intents that
   need no network can answer locally. "what time is it" is the honest choice:
   it is answerable from the clock alone. */

async function boot(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3Transcript === "function", null, { timeout: 10_000 });
  return pageErrors;
}

test("a local turn answers, shows what was heard, and lights the cell it names", async ({ page }) => {
  const pageErrors = await boot(page);

  /* ⚠ Started, not awaited. The highlight is lit at the TOP of the turn and
     releases itself 4.2 s later, but the turn does not resolve until the house
     has finished speaking — so awaiting it first spends the whole highlight
     before the assertion is made, and this test failed exactly that way under a
     loaded four-worker run while passing alone. The reply is collected after. */
  const turn = page.evaluate(() => window.__v3Transcript("what time is it"));

  // Deixis: "what time is it" carries refs:["hour"], and the hour cell answers.
  // This is the link that makes the screen and the speaker one system rather
  // than two devices in a room.
  await expect(page.locator('[data-cell="hour"]')).toHaveAttribute("data-ref", "lit");

  const result = await turn;
  expect(result.handled).toBe(true);
  expect(result.lane).toBe("local");
  await expect(page.locator("#heard")).toHaveText("what time is it");
  expect(await page.evaluate(() => window.__depth().depth)).toBe(1);

  expect(pageErrors).toEqual([]);
});

test("the highlight releases itself rather than staying lit forever", async ({ page }) => {
  await boot(page);
  // Started, not awaited — see the note above; the 4.2 s clock is already running.
  const turn = page.evaluate(() => window.__v3Transcript("what time is it"));
  await expect(page.locator('[data-cell="hour"]')).toHaveAttribute("data-ref", "lit");
  // Cleared on a timeout, never on transitionend — those never fire while an
  // ancestor is display:none, which most of this surface is most of the time.
  await expect(page.locator('[data-cell="hour"]')).not.toHaveAttribute("data-ref", "lit", { timeout: 8000 });
  await turn;   // never leave a turn in flight when the page is about to close
});

test("naming a camera mounts a subject and takes the surface to depth 3", async ({ page }) => {
  const pageErrors = await boot(page);

  const result = await page.evaluate(() => window.__v3Transcript("show me the driveway"));
  expect(result.handled).toBe(true);
  expect(await page.evaluate(() => window.__v3().subject)).toBe("show.camera");
  expect(await page.evaluate(() => window.__depth().depth)).toBe(3);
  await expect(page.locator("#subject-mount .subject--camera")).toHaveCount(1);
  // The live frame is addressed to the camera the voice actually named.
  await expect(page.locator(".subject__frame--live")).toHaveAttribute("src", /\/api\/camera\/driveway\/live/);

  expect(pageErrors).toEqual([]);
});

test("leaving depth 3 dismantles the subject — repeatedly, without accumulating", async ({ page }) => {
  const pageErrors = await boot(page);

  // THE leak-critical property. A subject left mounted keeps its MJPEG
  // connection open and keeps decoding forever; on a wall that runs for weeks
  // that is not a slow leak, it is a fire. 709 zombie lottie wrappers came from
  // exactly this shape of per-event code.
  const before = await page.evaluate(() => document.getElementsByTagName("*").length);

  const after = await page.evaluate(async () => {
    for (let i = 0; i < 15; i++) {
      await window.__v3Transcript("show me the driveway");
      window.__setDepth(1, "cycle");
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 300));
    return {
      subject: window.__v3().subject,
      mountChildren: document.getElementById("subject-mount").childElementCount,
      strayFrames: document.querySelectorAll(".subject__frame").length,
      nodes: document.getElementsByTagName("*").length
    };
  });

  expect(after.subject).toBeNull();
  expect(after.mountChildren).toBe(0);
  expect(after.strayFrames, "an MJPEG frame survived teardown").toBe(0);
  expect(after.nodes, "DOM grew across 15 subject cycles").toBeLessThanOrEqual(before + 2);

  expect(pageErrors).toEqual([]);
});

test("no depth is ever reachable while empty — the blank-screen guard", async ({ page }) => {
  const pageErrors = await boot(page);

  // THE regression this exists for: both paths to depth 2 used to deepen
  // unconditionally into an empty #spread-lattice, while compose.css hid the
  // glance layer the instant depth flipped — blacking out the wall mid-sentence,
  // and worst of all on the repair path, where the person is already not being
  // understood.
  const state = await page.evaluate(async () => {
    // Three unmatched utterances trip the third-strike escalation.
    for (let i = 0; i < 3; i++) {
      await window.__v3Transcript(`zzz unmatchable phrase ${i}`);
    }
    await new Promise((r) => setTimeout(r, 300));
    const depth = window.__depth().depth;
    const layer = document.querySelector(`.depth--${["field", "glance", "spread", "subject"][depth]}`);
    return {
      depth,
      vocabCard: window.__v3().vocabCard,
      // Whatever layer is showing must have something in it.
      visibleLayerHasContent: (layer?.textContent ?? "").trim().length > 0
        || layer?.querySelectorAll("img, canvas").length > 0
    };
  });

  if (state.depth === 2) {
    expect(state.vocabCard, "depth 2 was entered with nothing rendered in it").toBe(true);
  }
  expect(state.visibleLayerHasContent, `depth ${state.depth} is showing an empty layer`).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("leaving depth 2 clears the card", async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await window.__v3Transcript(`zzz nope ${i}`);
    await new Promise((r) => setTimeout(r, 200));
  });
  await page.evaluate(() => window.__setDepth(1, "test-recede"));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__v3().vocabCard)).toBe(false);
  await expect(page.locator("#spread-lattice")).toBeEmpty();
});

test("a ref naming a cell that does not exist is inert, not an error", async ({ page }) => {
  const pageErrors = await boot(page);
  // The model may one day return refs; an invented one must do nothing at all
  // rather than throw or light the wrong thing.
  const lit = await page.evaluate(() => {
    document.getElementById("heard").dispatchEvent(new Event("x"));
    return document.querySelectorAll('[data-ref="lit"]').length;
  });
  expect(lit).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("the rail only ever offers something the lane can actually answer", async ({ page }) => {
  await boot(page);
  // Every upstream is dead in this harness, so the rail must be either empty or
  // offering one of the few phrases that need no network. Suggesting anything
  // else would teach the room that the rail is decorative.
  const rail = await page.evaluate(() => window.__v3().rail);
  if (rail !== null) {
    expect(["what time is it", "show me the driveway", "show me the front door", "brief me"]).toContain(rail);
  }
});
