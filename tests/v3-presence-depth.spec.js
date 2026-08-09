import { test, expect } from "./fixtures/coverage.js";

/* Steps 1.4 + 1.5 — the point of Phase 1: the surface moves because the house
   moved, not because someone spoke to it.

   The rule under test, in the engine's own vocabulary rather than the plan's
   (there is no `band` field — bands are a documented score ladder plus a real
   `interrupt` boolean):

     interrupt         → GLANCE whether or not anyone is there
     score >= 70       → GLANCE only when someone is there
     score <  70       → nothing; that is the day's readouts, not news

   Driven through __forceCandidate and __v3Presence rather than by waiting for a
   real person, which is the same way the incumbent's presence tier is verified
   on the kiosk. */

async function bootV3(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  // Start from a known floor: the boot tick may have acted on real state.
  await page.evaluate(() => {
    window.__forceCandidate(null);
    window.__v3Presence(false);
    window.__setDepth(0, "spec");
    window.__v3Tick();
  });
  return pageErrors;
}

const candidate = (over = {}) => ({
  id: "spec:probe",
  source: "spec",
  text: "the back gate is open",
  score: 45,
  interrupt: false,
  cooldownMs: 0,
  ...over
});

async function drive(page, { present, cand }) {
  return page.evaluate(([present, cand]) => {
    window.__v3Presence(present);
    window.__forceCandidate(cand);
    const a = window.__v3Tick();
    return { ...a, depth: window.__depth().depth, reason: window.__depth().reason };
  }, [present, cand]);
}

test("an interrupt reaches the glance with nobody in the room", async ({ page }) => {
  const pageErrors = await bootV3(page);

  const r = await drive(page, { present: false, cand: candidate({ score: 95, interrupt: true }) });

  expect(r.mode).toBe("ambient");     // nobody there
  expect(r.present).toBe(false);
  expect(r.earned).toBe(true);
  expect(r.depth).toBe(1);
  expect(r.reason).toBe("attention:spec");
  expect(pageErrors).toEqual([]);
});

test("the High band waits for someone to be there", async ({ page }) => {
  await bootV3(page);

  // Absent: AMBIENT is interrupt-only, so the engine itself never offers it.
  const away = await drive(page, { present: false, cand: candidate({ score: 75 }) });
  expect(away.hero).toBeNull();
  expect(away.depth).toBe(0);

  // Present: same candidate, and now it earns the surface.
  const home = await drive(page, { present: true, cand: candidate({ score: 75 }) });
  expect(home.mode).toBe("glance");
  expect(home.hero?.id).toBe("spec:probe");
  expect(home.earned).toBe(true);
  expect(home.depth).toBe(1);
});

test("the day's readouts do not earn the screen even with someone there", async ({ page }) => {
  await bootV3(page);

  // 42 is what commute actually scored on the live wall. A surface that lit up
  // for this is a surface nobody trusts.
  const r = await drive(page, { present: true, cand: candidate({ score: 42 }) });

  expect(r.hero?.id).toBe("spec:probe");  // the engine still ranks it
  expect(r.earned).toBe(false);           // it just does not earn depth
  expect(r.depth).toBe(0);
});

test("the glance cell is filled, so depth 1 is never two empty paragraphs", async ({ page }) => {
  await bootV3(page);

  await drive(page, { present: true, cand: candidate({ score: 80, text: "the back gate is open" }) });

  const cell = await page.evaluate(() => ({
    said: document.getElementById("glance-said").textContent,
    addr: document.getElementById("glance-cell").dataset.cell
  }));

  expect(cell.said).toContain("back gate");
  // Re-addressed so the voice deixis highlight lands on whatever is actually up.
  expect(cell.addr).toBe("spec");
});

test("an empty room recedes to the field without waiting out the hold", async ({ page }) => {
  await bootV3(page);

  const up = await drive(page, { present: true, cand: candidate({ score: 80 }) });
  expect(up.depth).toBe(1);

  // The 90s GLANCE hold would get there eventually; presence loss is the faster,
  // truer cause. Nothing may be left on the cell either.
  const gone = await page.evaluate(() => {
    window.__v3Presence(false);
    return {
      depth: window.__depth().depth,
      reason: window.__depth().reason,
      said: document.getElementById("glance-said").textContent
    };
  });

  expect(gone.depth).toBe(0);
  expect(gone.reason).toBe("attention:absent");
  expect(gone.said).toBe("");
});

test("attention never pulls the surface out from under the voice", async ({ page }) => {
  const pageErrors = await bootV3(page);

  // The failure this guards is subtle and would never throw: deepen() falls
  // through to sustain() when the target is shallower, so a tick at SUBJECT
  // would re-arm the voice's hold every 30s and make it permanent.
  const r = await page.evaluate(() => {
    window.__setDepth(3, "voice:show cameras");
    window.__v3Presence(true);
    window.__forceCandidate({
      id: "spec:probe", source: "spec", text: "loud", score: 99, interrupt: true, cooldownMs: 0
    });
    const a = window.__v3Tick();
    return { acted: a.acted, depth: window.__depth().depth, reason: window.__depth().reason };
  });

  expect(r.acted).toBeNull();
  expect(r.depth).toBe(3);
  expect(r.reason).toBe("voice:show cameras"); // the hold was NOT re-armed
  expect(pageErrors).toEqual([]);
});

test("presence ignores `off`, because motion stopping is not somebody leaving", async ({ page }) => {
  await bootV3(page);

  const r = await page.evaluate(() => {
    window.__v3Presence(true);
    // A PIR reports movement, not occupancy: standing still to read the screen
    // sends `off` within seconds. Only the linger may decide absence.
    window.__emitHaState({ entity_id: "binary_sensor.kitchen_motion_detected", state: "off" });
    return window.__v3Presence();
  });

  expect(r.present).toBe(true);
});

test("a sensor stuck on since this morning is not somebody in the kitchen", async ({ page }) => {
  await bootV3(page);

  const r = await page.evaluate(() => {
    const old = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    // The opening snapshot replays ~700 entities including any that are `on`.
    // Trusting that would fake presence at every boot.
    window.__emitHaState({
      entity_id: "binary_sensor.kitchen_motion_detected", state: "on", last_changed: old
    });
    const stale = window.__v3Presence().present;

    window.__emitHaState({
      entity_id: "binary_sensor.kitchen_motion_detected", state: "on",
      last_changed: new Date().toISOString()
    });
    return { stale, fresh: window.__v3Presence().present };
  });

  expect(r.stale).toBe(false);
  expect(r.fresh).toBe(true);
});

test("real kitchen motion moves the surface, end to end", async ({ page }) => {
  const pageErrors = await bootV3(page);

  // The whole of Phase 1's "done when", in one pass: an entity arrives on the
  // bus exactly as the SSE would deliver it, and the wall moves off depth 0
  // with nobody having spoken.
  const r = await page.evaluate(() => {
    window.__forceCandidate({
      id: "spec:probe", source: "spec", text: "a real cause", score: 80, interrupt: false, cooldownMs: 0
    });
    window.__emitHaState({
      entity_id: "binary_sensor.kitchen_person_detected", state: "on",
      last_changed: new Date().toISOString()
    });
    const a = window.__v3Tick();
    return { present: a.present, mode: a.mode, depth: window.__depth().depth };
  });

  expect(r.present).toBe(true);
  expect(r.mode).toBe("glance");
  expect(r.depth).toBe(1);
  expect(pageErrors).toEqual([]);
});
