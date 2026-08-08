import { test, expect } from "@playwright/test";

/* Phase 2 on a real page — the half tests/v3-composer.spec.js cannot cover.
   The choosing is pure and tested in node; what needs a browser is everything
   about MOUNTING it: that depth 2 never flips while the lattice is empty, that a
   tick which changes nothing does not repaint, that leaving takes the cells with
   it, and that the two tenants of #spread-lattice do not stand on each other.

   Depth 2 is the one depth with a history of blacking the wall out (e3e9630),
   and every assertion here that looks defensive is about that. */

/* A cold house, deliberately and on every machine.
   The first run of this file composed a `triple-footer` instead of the expected
   pair, because a REAL Plex candidate had arrived from the developer's own NAS —
   the same trap as tests/reference-suite-hits-live-ha. Which template gets
   chosen is a function of how many candidates there are, so a spec about
   templates cannot share the queue with whatever happens to be playing in the
   living room. Every upstream is answered 503 here, which also holds the house
   to "absent is not empty": a dead API must produce NO candidates, not a
   confident empty one. Everything on screen then arrives via __forceCandidate. */
async function bootV3(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

/* Two ordinary low-band readouts — deliberately the kind of traffic that must
   NEVER reach depth 1 on its own (commute 42, tonight's menu 40 on the live
   wall), because the whole point of depth 2 is that dwelling earns them a place
   the High band would refuse them. `cooldownMs: 0` so the insight cooldown store
   can never make a run order-dependent. */
const ORDINARY = [
  { id: "spec:commute", source: "commute", text: "23 min to work", score: 42, cooldownMs: 0 },
  { id: "spec:menu", source: "menu", text: "Chicken fajitas", score: 40, cooldownMs: 0 }
];

/** Someone walked in and stayed. Returns the tick's own answer. */
async function dwell(page, candidates) {
  return page.evaluate((cands) => {
    window.__forceCandidate(cands);
    window.__v3Presence("dwell");
    return window.__v3Tick();
  }, candidates);
}

test("dwelling lays out the ordinary day, which the High band would never have shown", async ({ page }) => {
  const pageErrors = await bootV3(page);

  const tick = await dwell(page, ORDINARY);

  expect(tick.mode).toBe("dwell");
  expect(tick.dwelling).toBe(true);
  expect(tick.depth).toBe(2);
  // Two low-band readouts: neither earns the glance, and that is the point.
  expect(tick.earned).toBe(false);
  expect(tick.template).toBe("pair-note");

  const spread = await page.evaluate(() => {
    const host = document.getElementById("spread-lattice");
    return {
      template: window.__v3().spread,
      reason: window.__depth().reason,
      cells: Array.from(host.children).map((n) => ({
        className: n.className,
        cell: n.dataset.cell,
        voice: n.firstElementChild.className,
        text: n.textContent
      }))
    };
  });

  expect(spread.template).toBe("pair-note");
  expect(spread.reason).toBe("attention:spread");
  expect(spread.cells).toHaveLength(2);
  expect(spread.cells[0].className).toBe("cell cell--dominant");
  expect(spread.cells[1].className).toBe("cell cell--wide");
  // The type law, on the real nodes: the house speaking in the serif, the
  // readout in the sans.
  expect(spread.cells[0].voice).toBe("said said--1");
  expect(spread.cells[1].voice).toBe("measured measured--2");
  // Deixis addresses, so "what about the commute" lights the right rectangle.
  expect(spread.cells.map((c) => c.cell)).toEqual(["commute", "menu"]);
  expect(spread.cells[0].text).toContain("23 min");

  expect(pageErrors).toEqual([]);
});

test("depth 2 is never entered empty — one candidate is a glance, not a spread", async ({ page }) => {
  const pageErrors = await bootV3(page);

  const tick = await dwell(page, [ORDINARY[0]]);

  // A composition of one is null, and a null composition is simply no depth
  // change. Not a slower fuse, not a timer that fires into a blank rectangle.
  expect(tick.template).toBeNull();
  expect(tick.depth).toBeLessThan(2);
  expect(await page.evaluate(() => document.getElementById("spread-lattice").childElementCount)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("a tick that changes nothing does not repaint the spread", async ({ page }) => {
  await bootV3(page);
  await dwell(page, ORDINARY);

  /* The tick runs every 30 s for as long as someone is in the kitchen. If each
     one replaced the cells, @starting-style would fade the whole spread back in
     twice a minute, forever — motion with no cause the room can see, which is
     the one thing the calm law still forbids. Tagging the live nodes and
     re-ticking is the only way to tell a stable render from a lucky one: the
     text would look identical either way. */
  const survived = await page.evaluate(() => {
    for (const node of document.getElementById("spread-lattice").children) node.__probe = true;
    window.__v3Tick();
    return Array.from(document.getElementById("spread-lattice").children).map((n) => n.__probe === true);
  });
  expect(survived).toEqual([true, true]);

  // ...and a genuinely different composition still does replace them, or the
  // check above would be passing for the wrong reason.
  const replaced = await page.evaluate(() => {
    window.__forceCandidate([
      { id: "spec:other", source: "weather", text: "Rain by four", score: 42, cooldownMs: 0 },
      { id: "spec:menu", source: "menu", text: "Chicken fajitas", score: 40, cooldownMs: 0 }
    ]);
    window.__v3Tick();
    return Array.from(document.getElementById("spread-lattice").children).map((n) => n.__probe === true);
  });
  expect(replaced).toEqual([false, false]);
});

test("the spread recedes into its own dominant line, never into an empty glance", async ({ page }) => {
  await bootV3(page);
  await dwell(page, ORDINARY);

  /* The 45 s hold steps down one level. Depth 1 has exactly one cell and until
     now nothing filled it unless a candidate had cleared score 70 — so a
     low-band spread receding would have landed on two empty paragraphs and a
     photograph. The dominant is written as the spread mounts, for this moment. */
  const glance = await page.evaluate(() => {
    window.__setDepth(1, "recede");
    return {
      said: document.getElementById("glance-said").textContent,
      cell: document.getElementById("glance-cell").dataset.cell,
      lattice: document.getElementById("spread-lattice").childElementCount
    };
  });

  expect(glance.said).toContain("23 min");
  expect(glance.cell).toBe("commute");
  // And leaving depth 2 took the composition with it — a spread left mounted is
  // the same class of bug as a subject left holding its MJPEG connection open.
  expect(glance.lattice).toBe(0);
});

test("the room emptying drops straight to the field", async ({ page }) => {
  await bootV3(page);
  await dwell(page, ORDINARY);

  const rest = await page.evaluate(() => {
    window.__v3Presence(false);
    return {
      depth: window.__depth().depth,
      reason: window.__depth().reason,
      lattice: document.getElementById("spread-lattice").childElementCount,
      said: document.getElementById("glance-said").textContent
    };
  });

  // Straight to 0, not 2 → 1 → 0 over two and a half minutes of holds: the cause
  // for the spread was the person, and they are gone.
  expect(rest.depth).toBe(0);
  expect(rest.reason).toBe("attention:absent");
  expect(rest.lattice).toBe(0);
  expect(rest.said).toBe("");
});

test("a spoken ask takes the lattice, and the tick does not take it back", async ({ page }) => {
  const pageErrors = await bootV3(page);
  await dwell(page, ORDINARY);

  /* Both tenants write #spread-lattice. The composer must not overwrite a
     vocabulary card mid-conversation — the third-strike repair path shows that
     card at the exact moment someone has already not been understood three
     times, and the screen changing under them there is where a person stops
     talking to the wall for good.

     ⚠ THIS IS THE TEST THAT CAUGHT THE REAL BUG. The card is asked for while the
     surface is ALREADY at depth 2, so the voice reaches it through `sustain()`
     rather than a depth change — and `sustain()` fires no listeners at all. Any
     ownership flag maintained from `onDepth` is therefore still claiming the
     screen, and the very next 30-second tick takes it back off the card. Nothing
     throws; the wall just changes under someone who is mid-sentence. */
  const asked = await page.evaluate(async () => {
    await window.__v3Transcript("what can i say");
    return { depth: window.__depth().depth, spread: window.__v3().spread, card: window.__v3().vocabCard };
  });

  expect(asked.card).toBe(true);
  expect(asked.depth).toBe(2);
  // The composer's claim is gone the moment the card mounts, without any depth
  // change having happened to tell it so.
  expect(asked.spread).toBeNull();

  const after = await page.evaluate(() => window.__v3Tick());
  expect(after.depth).toBe(2);
  expect(after.template).toBeNull();
  expect(await page.evaluate(() => window.__v3().vocabCard)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("a long line steps down rather than trying to hold 132px", async ({ page }) => {
  await bootV3(page);

  await dwell(page, [
    { id: "spec:long", source: "insight", score: 42, cooldownMs: 0,
      text: "The bins go out tonight and it is forecast to rain before six in the morning" },
    ORDINARY[1]
  ]);

  const type = await page.evaluate(() => {
    const said = document.querySelector("#spread-lattice .said");
    return { len: said.dataset.len, size: getComputedStyle(said).fontSize };
  });

  // css/type.css has carried `.said[data-len="long"]` since V3 shipped and
  // nothing ever set it. 41+ characters is modules/focusHero.js's own tier-C
  // threshold, inherited so both surfaces break a line at the same place.
  expect(type.len).toBe("long");
  expect(type.size).toBe("96px");
});
