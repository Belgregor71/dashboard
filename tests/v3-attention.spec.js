import { test, expect } from "./fixtures/coverage.js";
import { pinHealthOk } from "./fixtures/health-ok.js";

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
  /* ⚠ Without this, "a cold house scores nothing" is not asking about a cold
     house at all. The suite's own dead-port HA stub makes the server report a
     real fault once it is a minute old, and the health lane then announces a
     score-72 candidate — so `queue`, `hero` and `sourceCount` all come back
     non-empty and the spec fails for a reason it is not about. See
     fixtures/health-ok.js; the timing is why it only shows up in a full run. */
  await pinHealthOk(page);
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

test("an empty room asks the engine as AMBIENT, which admits interrupts only", async ({ page }) => {
  await bootV3(page);

  /* ⚠ REWRITTEN AT 1.4, and worth saying why rather than quietly editing. This
     test used to assert the OPPOSITE — that the mode was borrowed from depth,
     so `__setDepth(2)` produced "dwell". That was 1.3's deliberate placeholder
     and 1.4 inverted it: the mode now comes from presence, and depth follows
     attention instead of leading it. The old assertion failing is the change
     landing correctly, so the assertion is turned around rather than deleted. */
  const rest = await page.evaluate(() => {
    window.__v3Presence(false);
    return { depth: window.__depth().depth, mode: window.__v3Tick().mode };
  });
  expect(rest.depth).toBe(0);
  expect(rest.mode).toBe("ambient");

  // Depth must no longer be able to talk back to the mode. If it could, a
  // voice-held SUBJECT would tell the engine the room is dwelling when there may
  // be nobody in it at all.
  const deep = await page.evaluate(() => {
    window.__setDepth(2, "spec");
    return window.__v3Tick().mode;
  });
  expect(deep).toBe("ambient");
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
