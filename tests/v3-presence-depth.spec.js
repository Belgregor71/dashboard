import { test, expect } from "./fixtures/coverage.js";
import { pinHealthOk } from "./fixtures/health-ok.js";

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

  /* ⚠ THE MEMORY LANE IS PINNED OFF, and it is not incidental. Arming
     initMemoryRuntime on V3 put authored memories into the attention queue at
     MEMORY_SCORE 44 — which outranks the 42 the "day's readouts" test forces,
     so the hero became `memory:tas-2021` and the assertion below failed for a
     correct reason.

     Turning it off here rather than loosening the assertion, because the deeper
     problem is that `data/memories/` is GITIGNORED: what the queue holds is a
     function of which JSON files happen to sit on the machine running the
     suite. That is the same hidden coupling tests/v3-spread.spec.js paid for
     with a real Plex session on the developer's NAS. This file is about
     presence and depth; the memory lane has its own spec. */
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body: (await res.text()) + "\nwindow.CONFIG.features.memoryEngine = false;\n"
    });
  });

  /* The health lane is pinned healthy for exactly the reason the memory lane
     above is pinned off: it announces at score 72, which outranks the 42 the
     "day's readouts" test forces, so the hero became `health` and the assertion
     failed for a correct reason. Same hidden coupling, one layer out — what the
     queue holds was a function of how long the test server had been up. */
  await pinHealthOk(page);

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

/* ═══ core/depth.js — the module, rather than the surfaces that ride it ══════
   A mutation sweep on 2026-09-19 found this file was the weakest in the house:
   of six semantic mutations to core/depth.js, five survived the WHOLE suite.
   Recession-to-an-inhabited-depth was covered (v3-alerts.spec.js) and nothing
   else was — the clamp, the hold teardown and the hold DURATIONS were all
   reachable only through surfaces that never looked at them.

   That matters here more than the coverage number suggests: depth is the only
   navigation V3 has, and the half of it that runs with nobody watching is
   exactly the half that had no test.
─────────────────────────────────────────────────────────────────────────── */

test.describe("depth is clamped, held once, and held for the documented time", () => {
  test("a depth outside 0..3 is clamped, never stored raw", async ({ page }) => {
    const pageErrors = await bootV3(page);

    // Past the deepest: SUBJECT, and still a legal depth the CSS has a rule for.
    // Unclamped, `data-depth` would read "9" and every `[data-depth]` selector
    // would stop matching — a blank wall with no error anywhere.
    const over = await page.evaluate(() => {
      window.__setDepth(9, "spec");
      return { depth: window.__depth().depth, attr: document.documentElement.dataset.depth };
    });
    expect(over).toEqual({ depth: 3, attr: "3" });

    const under = await page.evaluate(() => {
      window.__setDepth(-2, "spec");
      return { depth: window.__depth().depth, attr: document.documentElement.dataset.depth };
    });
    expect(under).toEqual({ depth: 0, attr: "0" });

    // Fractional causes land on a real depth rather than between two.
    const fractional = await page.evaluate(() => {
      window.__setDepth(2.7, "spec");
      return { depth: window.__depth().depth, attr: document.documentElement.dataset.depth };
    });
    expect(fractional).toEqual({ depth: 2, attr: "2" });
    expect(pageErrors).toEqual([]);
  });

  test("a second cause REPLACES the first one's hold rather than adding to it", async ({ page }) => {
    const pageErrors = await bootV3(page);

    /* The failure this guards: if clearHold() stops clearing, every setDepth
       leaves its timer armed. On a page that runs for weeks that is an
       unbounded pile of timers, and — visible long before the memory is — the
       FIRST cause's short hold still fires and drags the wall down out of a
       depth a later, longer cause had just asked for.

       Armed short, then re-armed long. After the short one would have fired,
       the wall must still be where the second cause put it. */
    const landed = await page.evaluate(async () => {
      window.__setDepth(3, "spec:short", { holdMs: 150 });
      window.__setDepth(3, "spec:long", { holdMs: 30_000 });
      await new Promise((r) => setTimeout(r, 600));
      return { depth: window.__depth().depth, reason: window.__depth().reason, held: window.__depth().held };
    });
    expect(landed.depth, "the replaced hold still fired and pulled the wall down").toBe(3);
    expect(landed.reason).toBe("spec:long");
    expect(landed.held).toBe(true);

    // The same rule through sustain(), which is the path motion takes: a fresh
    // cause for the depth we are already in must re-arm, not stack.
    const sustained = await page.evaluate(async () => {
      window.__setDepth(2, "spec:short2", { holdMs: 150 });
      window.__setDepth(2, "spec:sustain", { holdMs: 30_000 });
      await new Promise((r) => setTimeout(r, 600));
      return window.__depth().depth;
    });
    expect(sustained).toBe(2);
    expect(pageErrors).toEqual([]);
  });

  test("each depth holds for its own documented time, not some other depth's", async ({ page }) => {
    /* ⚠ THE HOLDS ARE THE ONLY THING DECIDING HOW LONG THE ROOM STAYS
       INTERESTING, and nothing pinned them: the sweep stretched SPREAD from 45 s
       to 450 s and the suite was green. 45 s is generous on purpose — a person
       cooking is present but not looking, and snapping them back to one line
       mid-task is the wrong read — so it is a design number, and a design number
       that can drift by 10x silently is not a design number.

       Driven on a fake clock: real time would make this a 45-second test, and a
       45-second test is one that gets deleted. */
    /* Installed BEFORE the boot, the way tests/v3-timers.spec.js does it: a
       clock installed after navigation does not own the timers that already
       exist, and the hold is armed by code that ran at boot. Pinned to midday
       so the screensaver and the briefing window cannot take the surface
       while the clock is being wound forward. Built from LOCAL components
       rather than a Z timestamp: this file pins no timezoneId, so a fixed UTC
       instant would be the middle of the night on a UTC runner. */
    await page.clock.install({ time: new Date(2026, 6, 6, 12, 0, 0) });
    const pageErrors = await bootV3(page);

    // SPREAD: 45 s. Just under, the wall is still there; just over, it has gone.
    await page.evaluate(() => window.__setDepth(2, "spec:hold"));
    await page.clock.runFor(44_000);
    expect(await page.evaluate(() => window.__depth().depth), "receded before 45 s").toBe(2);
    await page.clock.runFor(2_000);
    await expect.poll(() => page.evaluate(() => window.__depth().depth), { timeout: 5_000 })
      .toBeLessThan(2);

    // GLANCE: 90 s — twice the spread, deliberately. One line is cheap to leave up.
    await page.evaluate(() => window.__setDepth(1, "spec:hold"));
    await page.clock.runFor(89_000);
    expect(await page.evaluate(() => window.__depth().depth), "receded before 90 s").toBe(1);
    await page.clock.runFor(2_000);
    await expect.poll(() => page.evaluate(() => window.__depth().depth), { timeout: 5_000 }).toBe(0);

    // SUBJECT: 30 s — the shortest, because a subject is the most intrusive.
    await page.evaluate(() => window.__setDepth(3, "spec:hold"));
    await page.clock.runFor(29_000);
    expect(await page.evaluate(() => window.__depth().depth), "receded before 30 s").toBe(3);
    await page.clock.runFor(2_000);
    await expect.poll(() => page.evaluate(() => window.__depth().depth), { timeout: 5_000 })
      .toBeLessThan(3);

    // FIELD holds itself — nothing is armed there, or the wall would recede
    // off the floor it is supposed to rest on.
    await page.evaluate(() => window.__setDepth(0, "spec:hold"));
    expect(await page.evaluate(() => window.__depth().held)).toBe(false);
    expect(await page.evaluate(() => window.__depth().recedesTo)).toBeNull();
    expect(pageErrors).toEqual([]);
  });
});
