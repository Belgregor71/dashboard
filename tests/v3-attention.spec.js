import { test, expect } from "@playwright/test";

/* V3's attention tick — step 1.3. The engine itself is already covered in plain
   node by tests/insights.spec.js and tests/attention.spec.js, and the feed by
   tests/ha-entity-feed.spec.js and tests/house-snapshot.spec.js. What is NOT
   covered anywhere else, and is the only thing that can really go wrong here, is
   that the incumbent's decision layer survives being imported into a page that
   has 34 DOM nodes and none of its ids.

   So this file asks a page. It is deliberately about liveness and silence
   rather than about which candidate wins: upstreams are stubbed off in the test
   env, so the honest expectation is an EMPTY queue that was produced without
   anything throwing — which is exactly the "absent is not empty" answer the
   whole feed is built to give. */

async function bootV3(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

test("the attention engine runs on a page with none of the incumbent's DOM", async ({ page }) => {
  const pageErrors = await bootV3(page);

  const attention = await page.evaluate(() => window.__v3().attention);

  // A tick ran at boot and produced a real answer object, not undefined. If
  // getSelection() had thrown on the missing DOM this would be null.
  expect(attention).not.toBeNull();
  expect(Array.isArray(attention.queue)).toBe(true);
  expect(Array.isArray(attention.stack)).toBe(true);
  expect(typeof attention.sourceCount).toBe("number");

  // Nothing may reach the wall as an uncaught error. This is the only failure
  // signal tests/ui.spec.js trusts, and the reason this spec needs a page.
  expect(pageErrors).toEqual([]);
});

test("a cold house scores nothing rather than inventing something", async ({ page }) => {
  await bootV3(page);

  const attention = await page.evaluate(() => window.__v3().attention);

  // Every upstream is stubbed off in the test env, so houseSnapshot answers null
  // to everything and the adapters are all falsy-guarded. An empty queue is the
  // correct answer; a hero here would mean some adapter is manufacturing a
  // candidate out of a value it does not actually have.
  expect(attention.queue).toEqual([]);
  expect(attention.hero).toBeNull();
  expect(attention.sourceCount).toBe(0);
});

test("depth 0 asks the engine as AMBIENT, which admits interrupts only", async ({ page }) => {
  await bootV3(page);

  // The mode is borrowed from depth until 1.4 inverts it. At rest that must be
  // AMBIENT: if it read GLANCE, the resting wall would be eligible for the
  // ordinary queue the moment 1.4 gives the selection any authority.
  expect(await page.evaluate(() => window.__v3().depth.depth)).toBe(0);
  expect(await page.evaluate(() => window.__v3().attention.mode)).toBe("ambient");

  // And it tracks: put the surface deeper and the engine is asked a different
  // question. This is the seam 1.4 turns around.
  const deep = await page.evaluate(() => {
    window.__setDepth(2, "spec");
    return window.__v3Tick().mode;
  });
  expect(deep).toBe("dwell");
});

test("the flags the engine gates four phases on are actually set", async ({ page }) => {
  await bootV3(page);

  // V3 loads /js/config.js for exactly this. Without it every one of these reads
  // as false and V3 runs a quietly different engine than the wall does — no
  // error, no visible symptom, just a house that decides differently.
  const flags = await page.evaluate(() => ({
    attentionEngine: window.CONFIG?.features?.attentionEngine,
    predictiveCandidates: window.CONFIG?.features?.predictiveCandidates,
    houseIntent: window.CONFIG?.features?.houseIntent,
    memoryEngine: window.CONFIG?.features?.memoryEngine,
    personality: window.CONFIG?.features?.personality
  }));

  for (const [name, value] of Object.entries(flags)) {
    expect(value, `${name} is not readable from /v3/`).toBe(true);
  }
});

test("the engine's CDP handles exist on V3, so the queue can be driven on the wall", async ({ page }) => {
  const pageErrors = await bootV3(page);

  expect(await page.evaluate(() => typeof window.__forceCandidate)).toBe("function");
  expect(await page.evaluate(() => typeof window.__refreshAttention)).toBe("function");

  // Drive one through end to end: an injected candidate must reach the queue and
  // be ranked. `interrupt` because depth 0 borrows AMBIENT, which is
  // interrupt-only — a non-interrupt candidate would correctly be filtered out
  // and would prove nothing.
  const attention = await page.evaluate(() => {
    window.__forceCandidate({
      id: "spec:probe",
      source: "spec",
      text: "a probe",
      score: 90,
      interrupt: true,
      cooldownMs: 0
    });
    return window.__v3Tick();
  });

  expect(attention.queue.map((c) => c.id)).toContain("spec:probe");
  expect(attention.hero?.id).toBe("spec:probe");
  expect(pageErrors).toEqual([]);
});
