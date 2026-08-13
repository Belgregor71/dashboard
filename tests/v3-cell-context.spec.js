import { test, expect } from "./fixtures/coverage.js";

/* ═══════════════════════════════════════════════════════════════════════════
   CELL CONTEXT — the label above the value.

   Owner's verdict on a photograph of the live wall, 2026-08-13: "we have gone
   too far minimalist and lost context on most of the information". What the
   spread actually showed was "11 min · 18 min" at 132px with nothing saying
   whose drive either number was, "Colin from Accounts" with nothing saying it
   was the lounge room TV, and a floating quoted phrase in the corner.

   Every candidate has carried `title`/`sub` since the Tier-1a rich cards; V3
   rendered only `text`. So this feature adds no data and authors no copy — it
   renders a field that was already there, and these specs are about the three
   ways that can silently fail:

     · the flag not being a rollback (a blank label is not the same as no node);
     · the render signature not covering the label, which is the "shipped and
       changed nothing" bug this repo has hit before — the 30 s tick skips the
       DOM write when the signature matches, so a label outside it never mounts;
     · the eyebrow landing UNDER its line at depth 1, where the label node is
       the cell's second child and only CSS lifts it.

   Every upstream is 503 for the same reason as tests/v3-spread.spec.js: which
   template gets chosen is a function of how many candidates exist, and a real
   Plex session on the developer's NAS changed it once already.
   ═══════════════════════════════════════════════════════════════════════════ */

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

/* The two cells from the photograph, in candidate form. `sub` is the field the
   eyebrow renders; `text` is left exactly as the wall had it. */
const LABELLED = [
  { id: "spec:commute", source: "commute", text: "Greg 11 min · Brett 18 min", sub: "Drive to work", score: 42, cooldownMs: 0 },
  { id: "spec:plex", source: "plex", text: "Colin from Accounts", sub: "Lounge Room TV", score: 41, cooldownMs: 0 }
];

/* The same two with the field absent — an announcement, a memory, anything
   phrased rather than measured. These must render exactly as they do today. */
const UNLABELLED = LABELLED.map(({ sub, ...rest }) => rest);

const setFlag = (page, on) =>
  page.evaluate((v) => { window.CONFIG.features.v3CellContext = v; }, on);

async function dwell(page, candidates) {
  return page.evaluate((cands) => {
    window.__forceCandidate(cands);
    window.__v3Presence("dwell");
    return window.__v3Tick();
  }, candidates);
}

/** Every mounted cell, in DOM order, with its children in DOM order. */
const readCells = (page) => page.evaluate(() => {
  const host = document.getElementById("spread-lattice");
  return Array.from(host.children).map((n) => ({
    cellLabel: n.dataset.cellLabel ?? null,
    children: Array.from(n.children).map((c) => ({ className: c.className, text: c.textContent }))
  }));
});

test("flag off is the build that shipped before it — no label node anywhere", async ({ page }) => {
  const pageErrors = await bootV3(page);
  await setFlag(page, false);

  const tick = await dwell(page, LABELLED);
  expect(tick.depth).toBe(2);

  const cells = await readCells(page);
  expect(cells).toHaveLength(2);
  /* NOT "the label is empty". An empty <p> is a flex item and would carry the
     cell's 16px gap with it, moving the value on a wall that was supposed to be
     untouched. The rollback has to be the absence of the node. */
  for (const cell of cells) {
    expect(cell.children).toHaveLength(1);
    expect(cell.cellLabel).toBeNull();
  }
  // The dominant cell is the house's voice and the supporting one a readout —
  // grammar.js decides that per RECTANGLE, and neither is a label.
  expect(cells[0].children[0].className).toContain("said");
  expect(cells[1].children[0].className).toContain("measured");
  expect(await page.locator(".cell__label").count()).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("flag on puts the label ABOVE the value it labels", async ({ page }) => {
  const pageErrors = await bootV3(page);
  await setFlag(page, true);

  await dwell(page, LABELLED);
  const cells = await readCells(page);

  expect(cells).toHaveLength(2);
  // DOM order is the reading order here: eyebrow first, then the line.
  expect(cells[0].children[0].className).toContain("cell__label");
  expect(cells[0].children[0].text).toBe("Drive to work");
  expect(cells[0].children[1].text).toBe("Greg 11 min · Brett 18 min");

  expect(cells[1].children[0].text).toBe("Lounge Room TV");
  expect(cells[1].children[1].text).toBe("Colin from Accounts");

  /* Geometrically above, not merely earlier in the DOM. `.cell` is a flex
     column and a future `order` or `flex-direction` change would pass the DOM
     assertion above while printing the label under the value. */
  const box = await page.evaluate(() => {
    const cell = document.querySelector("#spread-lattice .cell");
    const label = cell.querySelector(".cell__label").getBoundingClientRect();
    const line = cell.querySelector(".said, .measured:not(.cell__label)").getBoundingClientRect();
    return { labelBottom: label.bottom, lineTop: line.top };
  });
  expect(box.labelBottom).toBeLessThanOrEqual(box.lineTop);
  expect(pageErrors).toEqual([]);
});

test("a candidate with no `sub` gets no label — never an empty one", async ({ page }) => {
  await bootV3(page);
  await setFlag(page, true);

  await dwell(page, UNLABELLED);
  const cells = await readCells(page);

  expect(cells).toHaveLength(2);
  for (const cell of cells) expect(cell.children).toHaveLength(1);
  expect(await page.locator(".cell__label").count()).toBe(0);
});

test("the label is part of the render signature — the tick cannot skip it", async ({ page }) => {
  /* ⚠ THE GUARD THAT MATTERS. renderSpread leaves the DOM alone when the
     composition resolves to the same template and the same candidate ids, which
     is what stops the wall fading itself in every 30 seconds. With the label
     outside that signature, the ids here never change — so the cells mounted
     label-less below would still be label-less after the flag went on, and the
     feature would look shipped while changing nothing on the glass.

     Injected-defect check: drop `~${label}` from spread.js signatureOf and this
     is the assertion that goes red. */
  await bootV3(page);

  /* ⚠ SCOPED TO THE LATTICE. A document-wide count reads 3, not 2, and the
     third is correct: the spread's dominant candidate is written into the
     glance cell as the spread mounts (so depth 2 can recede into it), and it
     carries the same label. Counting the whole page would make this spec fail
     for a reason that has nothing to do with what it is testing. */
  const labels = page.locator("#spread-lattice .cell__label");

  await setFlag(page, false);
  await dwell(page, LABELLED);
  expect(await labels.count()).toBe(0);

  await setFlag(page, true);
  await dwell(page, LABELLED);           // same ids, same template, same order
  expect(await labels.count()).toBe(2);

  // And the other direction, because flipping off is the rollback path.
  await setFlag(page, false);
  await dwell(page, LABELLED);
  expect(await labels.count()).toBe(0);
});

test("an unchanged tick still does not repaint — the calm law survives", async ({ page }) => {
  // The signature got a new component; it must not have become a value that
  // differs every tick, or depth 2 would re-enter (and re-fade) every 30 s.
  await bootV3(page);
  await setFlag(page, true);

  await dwell(page, LABELLED);
  /* Node identity, compared inside the page — a re-render replaces every cell,
     which is what re-triggers @starting-style and fades the whole spread back
     in. Same node after the tick means the DOM was genuinely left alone. */
  const same = await page.evaluate(() => {
    const before = document.querySelector("#spread-lattice .cell__label");
    if (!before) return "no label mounted";
    window.__v3Tick();
    return before === document.querySelector("#spread-lattice .cell__label");
  });
  expect(same).toBe(true);
});

/* ── Depth 1 ──────────────────────────────────────────────────────────────── */

const HERO = [{
  id: "spec:hero", source: "plex", text: "Colin from Accounts",
  sub: "Lounge Room TV", score: 88, cooldownMs: 0
}];

test("the glance cell's label is lifted above its line, and only when labelled", async ({ page }) => {
  /* `#glance-measured` is the cell's SECOND child in index.html and has only
     ever been blanked. It is the eyebrow now — which means CSS has to lift it,
     and the lift is scoped to [data-labelled] so an unlabelled glance keeps the
     geometry it has always had. */
  const pageErrors = await bootV3(page);
  await setFlag(page, true);

  await page.evaluate((cands) => {
    window.__forceCandidate(cands);
    window.__v3Presence(true);
    return window.__v3Tick();
  }, HERO);

  const glance = await page.evaluate(() => {
    const cell = document.getElementById("glance-cell");
    const label = document.getElementById("glance-measured");
    const said = document.getElementById("glance-said");
    return {
      labelled: cell.hasAttribute("data-labelled"),
      text: label.textContent,
      order: getComputedStyle(label).order,
      labelBottom: label.getBoundingClientRect().bottom,
      saidTop: said.getBoundingClientRect().top
    };
  });

  expect(glance.labelled).toBe(true);
  expect(glance.text).toBe("Lounge Room TV");
  expect(glance.order).toBe("-1");
  expect(glance.labelBottom).toBeLessThanOrEqual(glance.saidTop);
  expect(pageErrors).toEqual([]);
});

test("flag off leaves the glance cell exactly as it was — no attribute, no class", async ({ page }) => {
  await bootV3(page);
  await setFlag(page, false);

  await page.evaluate((cands) => {
    window.__forceCandidate(cands);
    window.__v3Presence(true);
    return window.__v3Tick();
  }, HERO);

  const glance = await page.evaluate(() => {
    const label = document.getElementById("glance-measured");
    return {
      labelled: document.getElementById("glance-cell").hasAttribute("data-labelled"),
      text: label.textContent,
      className: label.className,
      order: getComputedStyle(label).order
    };
  });

  expect(glance.labelled).toBe(false);
  expect(glance.text).toBe("");
  expect(glance.className).not.toContain("cell__label");
  expect(glance.order).toBe("0");
});

/* ── The vocabulary rail ──────────────────────────────────────────────────── */

test("the rail keeps depth 1 and is gone from the spread", async ({ page }) => {
  /* Seen on the glass 2026-08-13 sharing the bottom-right corner with a
     composed spread: "what's on the shopping list", quoted and unattached,
     reading as a fourth piece of content rather than as an offer. Owner's
     verdict: no value on that screen. It is not deleted — depth 1 gives it the
     corner to itself against one line. */
  await bootV3(page);

  /* ⚠ POLLED, NOT READ ONCE. `.rail-slot` transitions its opacity over
     --m-calm, and getComputedStyle during a transition returns the INTERPOLATED
     value — so a synchronous read straight after the depth change reports the
     opacity it is leaving, and this spec would assert the exact opposite of the
     rule while looking correct. */
  const settlesTo = async (depth, value) => {
    await page.evaluate((d) => window.__setDepth(d, "spec"), depth);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector(".rail-slot")).opacity),
        { message: `rail-slot opacity at depth ${depth}` })
      .toBe(value);
  };

  await settlesTo(1, "1");
  await settlesTo(2, "0");
  await settlesTo(0, "0");
});
