import { test, expect } from "@playwright/test";
import { cameraTriggerCandidate } from "../src/js/services/candidateSources.js";
import { rankQueue, selectForMode, MODE } from "../src/js/services/attentionRank.js";

/* Phase 3 on a page — the events that reach the screen with nobody asking.

   The decision is pure and covered in tests/alert-router.spec.js. What needs a
   browser is what those decisions DO: that the door takes depth 3 and takes it
   from whatever was there, that a stale sensor in the boot snapshot cannot, that
   an arrival goes through the queue rather than around it, and that a surface
   driven deep with nobody watching can find its way back to something. */

async function bootV3(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  // Cold house, every machine — see the note in tests/v3-spread.spec.js. Alerts
  // are interrupt-band so they would out-rank live traffic anyway, but the
  // arrival cases assert what the glance cell CONTAINS, and that is not safe to
  // share with whatever is playing in the living room.
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

/* ── 3.2 · What must NOT interrupt ─────────────────────────────────────────
   Pure, because the whole question is what the ranking permits.

   The plan has 3.2 as "camera motion trigger → D1 glance — mostly covered by
   1.4; verify rather than build". Verified, and it is not covered: a camera
   trigger CANNOT reach depth 1 and should not. It scores 45 — Low band, well
   under the 70 the glance demands — and carries `stackOnly`, which bars it from
   ever being the hero. It is depth-2 traffic, and it only appears while someone
   is standing in the room.

   That is the right answer rather than a gap. The two cameras that must
   interrupt are the front door and the side gate, and both go through the alert
   path above and force depth 3. A driveway that lit the wall every time a car
   went past would be the "Chicken Fajitas" failure with a picture attached.
─────────────────────────────────────────────────────────────────────────── */

const trigger = (at) => cameraTriggerCandidate({
  cameraTriggerName: "driveway",
  cameraTriggerAt: at,
  cameraTriggerLabel: "Last triggered 3:04 pm",
  cameraTriggerImage: null
});

test("ordinary camera motion is Low band and can never be the hero", () => {
  const candidate = trigger(Date.now());
  expect(candidate.score).toBe(45);
  expect(candidate.stackOnly).toBe(true);
  expect(candidate.interrupt).toBeUndefined();

  // Below the glance floor. attention.js earnsGlance() is `interrupt || >= 70`.
  expect(candidate.score).toBeLessThan(70);
});

test("an empty room never sees a camera trigger at all", () => {
  const now = new Date();
  const queue = rankQueue([trigger(now.getTime())], now);
  // AMBIENT admits interrupts only, and motion on the driveway is not one.
  expect(selectForMode(queue, MODE.AMBIENT, { now }).stack).toEqual([]);
});

test("a camera trigger reaches the spread, and only the spread", () => {
  const now = new Date();
  const other = { id: "x", source: "commute", text: "23 min", score: 42, cooldownMs: 0 };
  const queue = rankQueue([trigger(now.getTime()), other], now);

  // Someone present but not settled: depth 1, and the hero must be the commute
  // because the trigger is stackOnly. So the trigger is not shown.
  const glance = selectForMode(queue, MODE.GLANCE, { now });
  expect(glance.hero.id).toBe("x");
  expect(glance.stack.map((c) => c.id)).toEqual(["x"]);

  // Someone dwelling: depth 3, and it rides in as a supporting cell.
  const dwell = selectForMode(queue, MODE.DWELL, { now });
  expect(dwell.hero.id).toBe("x");
  expect(dwell.stack.map((c) => c.source)).toContain("cameraTrigger");
});

/* ── 3.1 · The door ────────────────────────────────────────────────────────── */

test("someone at the door puts the door on the screen, without anyone asking", async ({ page }) => {
  const pageErrors = await bootV3(page);

  // Nobody is in the room and nobody has spoken. This is the whole phase.
  const state = await page.evaluate(async () => {
    window.__v3Presence(false);
    const alert = await window.__v3Alert("binary_sensor.doorbell_ringing", "on");
    return {
      alert,
      depth: window.__depth().depth,
      reason: window.__depth().reason,
      subject: window.__v3().subject,
      caption: document.querySelector(".subject__caption")?.textContent ?? null,
      still: document.querySelector(".subject__frame")?.getAttribute("src") ?? null
    };
  });

  expect(state.depth).toBe(3);
  expect(state.reason).toBe("alert:doorbell");
  expect(state.subject).toBe("show.camera");
  expect(state.caption).toBe("The front door");
  expect(state.still).toContain("/api/camera/doorbell/snapshot");
  expect(state.alert.prefix).toBe("doorbell");
  expect(state.alert.shown).toBe(true);
  expect(typeof state.alert.line).toBe("string");

  expect(pageErrors).toEqual([]);
});

test("a sensor stuck on since this morning is not somebody at the door", async ({ page }) => {
  const pageErrors = await bootV3(page);

  /* ⚠ The trap this phase inherited from presence.js. The opening SSE frame
     replays every entity in the house, so a doorbell reading `on` since 9am
     would announce a visitor AND take the wall to depth 3 on every page load —
     out loud, with nobody there, forever. */
  const state = await page.evaluate(async () => {
    const stale = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    window.__emitHaState({
      entity_id: "binary_sensor.doorbell_ringing",
      state: "on",
      last_changed: stale
    });
    await new Promise((r) => setTimeout(r, 150));
    return { depth: window.__depth().depth, alert: window.__v3().alert, subject: window.__v3().subject };
  });

  expect(state.depth).toBe(0);
  expect(state.alert).toBeNull();
  expect(state.subject).toBeNull();
  expect(pageErrors).toEqual([]);
});

test("the door goes through the feed, not just the debug hook", async ({ page }) => {
  const pageErrors = await bootV3(page);

  // V3 subscribes to the event BUS; the incumbent's document re-broadcast does
  // not exist here. A handler wired to the wrong one would pass every test that
  // called raiseAlert directly and do nothing at all on the wall.
  await page.evaluate(() => {
    window.__emitHaState({
      entity_id: "binary_sensor.side_gate_person_detected",
      state: "on",
      last_changed: new Date().toISOString()
    });
  });

  await page.waitForFunction(() => window.__depth().depth === 3, null, { timeout: 3000 });
  expect(await page.evaluate(() => window.__depth().reason)).toBe("alert:side_gate");
  expect(await page.evaluate(() => document.querySelector(".subject__caption")?.textContent)).toBe("The side gate");
  expect(pageErrors).toEqual([]);
});

test("the door outranks the subject already up — forced, not deepened", async ({ page }) => {
  const pageErrors = await bootV3(page);

  /* `deepen(SUBJECT)` from depth 3 falls through to `sustain()`, which re-arms
     the hold and leaves the OLD camera mounted. The doorbell would then be
     announced over a picture of the side gate — silently, and looking exactly
     like the doorbell camera being broken. */
  const state = await page.evaluate(async () => {
    await window.__v3Alert("binary_sensor.side_gate_person_detected", "on");
    const before = {
      reason: window.__depth().reason,
      caption: document.querySelector(".subject__caption")?.textContent
    };
    await window.__v3Alert("binary_sensor.doorbell_ringing", "on");
    return {
      before,
      after: {
        depth: window.__depth().depth,
        reason: window.__depth().reason,
        caption: document.querySelector(".subject__caption")?.textContent,
        // One subject, never two stacked in the mount — a left-over MJPEG <img>
        // keeps its connection open for the life of the page.
        frames: document.querySelectorAll("#subject-mount .subject").length
      }
    };
  });

  expect(state.before.caption).toBe("The side gate");
  expect(state.after.depth).toBe(3);
  expect(state.after.reason).toBe("alert:doorbell");
  expect(state.after.caption).toBe("The front door");
  expect(state.after.frames).toBe(1);
  expect(pageErrors).toEqual([]);
});

/* ── Recession ─────────────────────────────────────────────────────────────── */

test("a subject that times out never lands on an empty depth", async ({ page }) => {
  const pageErrors = await bootV3(page);

  /* Recession used to step down exactly one level. Nothing had hit it because
     every route to depth 3 was a spoken one, with a person standing there to say
     something else — Phase 3 is the first that drives the surface deep with
     nobody watching, so the doorbell would have receded onto a blank depth 2 and
     held it there for 45 seconds, then a blank depth 1 for 90 more. */
  const empty = await page.evaluate(async () => {
    await window.__v3Alert("binary_sensor.doorbell_ringing", "on");
    return {
      lattice: document.getElementById("spread-lattice").childElementCount,
      glance: document.getElementById("glance-said").textContent,
      recedesTo: window.__depth().recedesTo
    };
  });

  // Both intermediate depths are empty, so the field is the only honest landing.
  expect(empty.lattice).toBe(0);
  expect(empty.glance).toBe("");
  expect(empty.recedesTo).toBe(0);

  // Driven for real through the timer rather than only read off the probe.
  const landed = await page.evaluate(async () => {
    window.__setDepth(3, "spec", { holdMs: 120 });
    await new Promise((r) => setTimeout(r, 400));
    const depth = window.__depth().depth;
    const layer = document.querySelector(`.depth--${["field", "glance", "spread", "subject"][depth]}`);
    return { depth, reason: window.__depth().reason, text: (layer?.textContent ?? "").trim() };
  });

  expect(landed.depth).toBe(0);
  expect(landed.reason).toBe("recede");
  // The field is the floor precisely because it can never be empty.
  expect(landed.text.length).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test("recession stops at a depth that does have something in it", async ({ page }) => {
  await bootV3(page);

  // The other half of the same rule, or the first test would pass just as well
  // with a "recede straight to zero" implementation that ignores content.
  const state = await page.evaluate(async () => {
    window.__forceCandidate({
      id: "spec:door", source: "camera", text: "Someone at the door", score: 95,
      interrupt: true, cooldownMs: 0
    });
    window.__v3Tick();                       // fills the glance cell
    const glanceFilled = document.getElementById("glance-said").textContent;

    window.__setDepth(3, "spec", { holdMs: 120 });
    const recedesTo = window.__depth().recedesTo;
    await new Promise((r) => setTimeout(r, 400));
    return { glanceFilled, recedesTo, depth: window.__depth().depth };
  });

  expect(state.glanceFilled.length).toBeGreaterThan(0);
  expect(state.recedesTo).toBe(1);
  expect(state.depth).toBe(1);
});

/* ── 3.3 · Arrival ─────────────────────────────────────────────────────────── */

test("coming home reaches the glance through the queue, not around it", async ({ page }) => {
  const pageErrors = await bootV3(page);

  const state = await page.evaluate(() => {
    window.__v3Presence(false);              // nobody has been seen in the kitchen yet
    window.__v3Arrival("person.greg", "not_home");
    window.__v3Arrival("person.greg", "home");
    return {
      arrival: window.__v3().arrival,
      announced: window.__v3().announced,
      hero: window.__v3().attention.hero,
      depth: window.__depth().depth,
      reason: window.__depth().reason,
      said: document.getElementById("glance-said").textContent,
      cell: document.getElementById("glance-cell").dataset.cell
    };
  });

  // Announced as a candidate — so it inherits the ranking, the interrupt rule,
  // the personality voice, quiet mode and expiresAt decay rather than
  // reimplementing any of them, and nothing but attention writes the cell.
  expect(state.announced.map((c) => c.id)).toEqual(["arrival:person.greg"]);
  expect(state.announced[0].expiresAt).toBeGreaterThan(Date.now());
  expect(state.hero.id).toBe("arrival:person.greg");
  expect(state.hero.interrupt).toBe(true);

  // Interrupt band, so it reaches the screen with the room empty.
  expect(state.depth).toBe(1);
  expect(state.reason).toBe("attention:arrival");
  expect(state.cell).toBe("arrival");
  expect(state.said).toContain("Greg");
  expect(state.arrival.text).toContain("Greg");

  expect(pageErrors).toEqual([]);
});

test("a phone whose wifi blinked did not come home", async ({ page }) => {
  const pageErrors = await bootV3(page);

  /* 27 false arrivals in five days, July 2026: iphonedetect was flapping person
     entities away and back within seconds. The root cause was fixed upstream in
     HA (consider_home 60s → 900s) and the incumbent STILL has no guard of its
     own — a surface that greets you every time your phone blinks teaches you to
     stop believing it. */
  const state = await page.evaluate(() => {
    window.__v3Arrival("person.sam", "home");      // the snapshot: already in
    window.__v3Arrival("person.sam", "not_home");  // ...and out, just now
    window.__v3Arrival("person.sam", "home");      // ...and back, seconds later
    return {
      arrival: window.__v3().arrival,
      announced: window.__v3().announced,
      depth: window.__depth().depth
    };
  });

  expect(state.arrival.suppressed).toBe("too-brief");
  expect(state.announced).toEqual([]);
  expect(state.depth).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("the boot snapshot finding someone home is not a greeting", async ({ page }) => {
  const pageErrors = await bootV3(page);

  // The opening frame sends an update for everyone already in. That is the page
  // finding out what is true, not an arrival — only a transition observed in
  // this session counts.
  const state = await page.evaluate(() => {
    window.__emitHaState({ entity_id: "person.greg", state: "home", attributes: {} });
    return { arrival: window.__v3().arrival, announced: window.__v3().announced, depth: window.__depth().depth };
  });

  expect(state.arrival).toBeNull();
  expect(state.announced).toEqual([]);
  expect(state.depth).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("an announcement decays out of the queue on its own", async ({ page }) => {
  await bootV3(page);

  /* There is no timer behind announce() and nothing to tear down — the whole
     lifetime is expiresAt, read by rankQueue and pruned on the next tick. On a
     surface that runs for weeks, a list that only ever grows is the failure
     mode, so this checks the pruning rather than just the ranking. */
  const state = await page.evaluate(() => {
    window.__v3Arrival("person.greg", "not_home");
    window.__v3Arrival("person.greg", "home");
    const before = window.__v3().announced.length;

    // Tick from far enough in the future that the announcement has expired.
    const later = new Date(Date.now() + 10 * 60 * 1000);
    const sel = window.__v3Tick(later);
    return { before, after: window.__v3().announced.length, heroIds: sel.queue.map((c) => c.id) };
  });

  expect(state.before).toBe(1);
  expect(state.after).toBe(0);
  expect(state.heroIds).not.toContain("arrival:person.greg");
});
