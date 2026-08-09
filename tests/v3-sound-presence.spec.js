import { test, expect } from "@playwright/test";

/* The client half of sound presence: a `sound:presence` bus event has to reach
   V3's presence module and count as somebody being there — but only with the
   flag on, and additively with the camera rather than instead of it.

   The flag exists because the kitchen camera's detection gets switched off by a
   member of the household, and recoveryService guard 1 keeps switching it back
   on. A second source is what makes the camera safe to lose. */

/** Boot V3 with features.soundPresence pinned to a known value. */
async function bootV3(page, { soundPresence }) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // Pinned, never inherited from the default: the rollback path for this
  // feature is flipping the flag back, so both states must keep being tested
  // after the default moves.
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        `\nwindow.CONFIG.features.soundPresence = ${soundPresence};\n`
    });
  });

  await page.goto("/v3/");
  await page.waitForFunction(() =>
    typeof window.__v3Presence === "function" &&
    typeof window.__emitSoundPresence === "function"
  );
  await page.evaluate(() => window.__v3Presence(false));
  return pageErrors;
}

/* The bus, not the SSE: presence-light owns the only EventSource carrying this
   event and re-broadcasts it, so the bus is the real seam presence subscribes
   to. Driving it directly tests the half that is V3's.

   ⚠ Via the debug handle, NOT `import("/js/core/eventBus.js")` — the build
   bundles that module into a hashed asset, so importing it by path 404s against
   the dist the test server serves, and the spec fails for a reason that has
   nothing to do with sound presence. */
async function emitSound(page) {
  await page.evaluate(() => window.__emitSoundPresence());
}

test("flag ON: a sound event is somebody being there", async ({ page }) => {
  const pageErrors = await bootV3(page, { soundPresence: true });

  expect(await page.evaluate(() => window.__v3Presence().present)).toBe(false);
  await emitSound(page);

  const after = await page.evaluate(() => window.__v3Presence());
  expect(after.present).toBe(true);
  // Which source saw them — the difference between "the camera is dead" and
  // "the room is quiet" is otherwise unreadable from outside.
  expect(after.lastReason).toBe("sound");
  expect(after.soundEnabled).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("flag OFF: the event still arrives and is still ignored", async ({ page }) => {
  // Off has to be genuinely inert, not merely unsubscribed — the surface must
  // behave exactly as it does today.
  const pageErrors = await bootV3(page, { soundPresence: false });

  await emitSound(page);

  const after = await page.evaluate(() => window.__v3Presence());
  expect(after.present).toBe(false);
  expect(after.lastReason).toBeNull();
  expect(after.soundEnabled).toBe(false);
  expect(pageErrors).toEqual([]);
});

test("sound does not veto the camera, and the camera does not veto sound", async ({ page }) => {
  // Additive by design: whichever notices first wins. That is the whole reason
  // the camera becomes safe to lose.
  const pageErrors = await bootV3(page, { soundPresence: true });

  await page.evaluate(() =>
    window.__emitHaState({
      entity_id: "binary_sensor.kitchen_motion_detected",
      state: "on",
      last_changed: new Date().toISOString()
    })
  );
  expect(await page.evaluate(() => window.__v3Presence().lastReason)).toBe("motion");

  await emitSound(page);
  const after = await page.evaluate(() => window.__v3Presence());
  expect(after.present).toBe(true);
  expect(after.lastReason).toBe("sound");
  expect(pageErrors).toEqual([]);
});

test("sound re-arms the linger rather than starting a second clock", async ({ page }) => {
  // Sound reports ACTIVITY, so it feeds the same seam the PIR does and absence
  // stays the linger's job. A person reading the screen in silence trips
  // neither, and the linger is what covers them.
  const pageErrors = await bootV3(page, { soundPresence: true });

  await emitSound(page);
  const first = await page.evaluate(() => window.__v3Presence());
  await page.waitForTimeout(250);
  await emitSound(page);
  const second = await page.evaluate(() => window.__v3Presence());

  expect(second.lastMotionAt).toBeGreaterThan(first.lastMotionAt);
  expect(second.sinceMotionMs).toBeLessThan(first.sinceMotionMs + 250);
  expect(second.present).toBe(true);
  expect(pageErrors).toEqual([]);
});
