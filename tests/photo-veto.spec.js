import { test, expect } from "@playwright/test";
import { matchIntent } from "../src/js/services/localIntents.js";

/* THE PHOTOGRAPH VETO — "not this one", and the wall never shows it again.

   The only quality signal this library has. Everything automatic was measured
   and rejected first (server/services/photoVeto.js has the numbers), so the
   house asks instead of guessing.

   Three things are worth testing and one of them is subtle: the matcher has to
   reach these phrases THROUGH the mutation guard, which exists to send commands
   to HA Assist — a lane that cannot hide a photograph on this wall. */

// ── The words ───────────────────────────────────────────────────────────────

test("the veto is heard however it is phrased", () => {
  for (const said of [
    "not this one",
    "not that photo",
    "hide this one",
    "hide it",
    "never show that again",
    "get rid of this picture",
    "don't like this one"
  ]) {
    expect(matchIntent(said)?.id, said).toBe("photo.veto");
  }
});

test("⚠ the phrasings that open with a BANNED verb still reach the veto", () => {
  /* "delete" and "remove" are both in MUTATION_RE, which returns null so the
     turn falls through to HA Assist. Assist cannot hide a photograph here, and
     neither can the model behind it — so a lane that can only SOUND like it
     complied would have taken these. This is the assertion that pins the
     exemption; without it the natural phrasing silently does nothing. */
  expect(matchIntent("delete this photo")?.id).toBe("photo.veto");
  expect(matchIntent("remove that picture")?.id).toBe("photo.veto");
});

test("the way back is heard, including the phrasing the guard would eat", () => {
  for (const said of ["bring that back", "undo that", "undo", "i didn't mean that"]) {
    expect(matchIntent(said)?.id, said).toBe("photo.restore");
  }
  // "put" is a banned leading verb, exactly like "delete" above.
  expect(matchIntent("put that back")?.id).toBe("photo.restore");
});

test("⚠⚠ the mutation guard is INTACT — the exemption is a door, not a hole", () => {
  /* The whole risk of matching before the guard is that something else slips
     through with it. These are the utterances the guard exists for: they must
     still fall through to the lane that owns them. */
  expect(matchIntent("add oat milk to the shopping list")).toBeNull();
  expect(matchIntent("turn on the backyard light")).toBeNull();
  expect(matchIntent("remind me to call mum")).toBeNull();
  expect(matchIntent("set a timer")).toBeNull();
});

test("a veto phrase does not eat an ordinary question", () => {
  // The demonstratives are the risky half of the pattern, so the neighbours it
  // could plausibly swallow are pinned.
  expect(matchIntent("what's this song")?.id).toBe("house.media");
  expect(matchIntent("what's the weather")?.id).toBe("weather.now");
  expect(matchIntent("show me the driveway")?.id).toBe("show.camera");
});

// ── The list ────────────────────────────────────────────────────────────────

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

test.describe("the hidden list", () => {
  // Restores whatever the box already had, so running the suite on the kiosk
  // host cannot quietly hide a real photograph from the real wall.
  test.afterEach(async ({ request }) => {
    await request.post("/api/immich/hidden/undo");
  });

  test("GET /api/immich/hidden returns { ids: array }", async ({ request }) => {
    const res = await request.get("/api/immich/hidden");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.ids)).toBe(true);
  });

  test("a veto with no valid id is a JSON 400, not a silent success", async ({ request }) => {
    for (const data of [{}, { id: "not-a-uuid" }, { ids: [] }]) {
      const res = await request.post("/api/immich/hidden", { data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
  });

  test("a hidden id is remembered, and undo takes back the whole frame", async ({ request }) => {
    // A pair, because a diptych is hidden WHOLE — undoing half of a frame the
    // room rejected as one picture is the failure this shape prevents.
    const hidden = await (
      await request.post("/api/immich/hidden", { data: { ids: [UUID_A, UUID_B] } })
    ).json();
    expect(hidden.hidden).toEqual([UUID_A, UUID_B]);

    const after = await (await request.get("/api/immich/hidden")).json();
    expect(after.ids).toEqual(expect.arrayContaining([UUID_A, UUID_B]));

    const undone = await (await request.post("/api/immich/hidden/undo")).json();
    expect(undone.restored).toEqual([UUID_A, UUID_B]);

    const finalState = await (await request.get("/api/immich/hidden")).json();
    expect(finalState.ids).not.toContain(UUID_A);
    expect(finalState.ids).not.toContain(UUID_B);
  });

  test("a hidden photograph is filtered at the SEARCH, not per surface", async ({ request }) => {
    /* The filter sits in immichClient's usableImage — the single choke point
       every search passes through — so a veto spoken at the ambient ground also
       holds on the screensaver and in Daily Memories. Immich is not configured
       in this harness, so this asserts the CONTRACT survives a veto (a real id
       would need a real library); the shape is what the routes promise. */
    const before = await (await request.get("/api/immich/on-this-day")).json();
    await request.post("/api/immich/hidden", { data: { id: UUID_A } });
    const after = await (await request.get("/api/immich/on-this-day")).json();

    expect(Array.isArray(before.assets)).toBe(true);
    expect(Array.isArray(after.assets)).toBe(true);
    expect(after.assets.some((a) => a.id === UUID_A)).toBe(false);
  });

  test("vetoing the same photograph twice does not double it", async ({ request }) => {
    await request.post("/api/immich/hidden", { data: { id: UUID_A } });
    const second = await (
      await request.post("/api/immich/hidden", { data: { id: UUID_A } })
    ).json();

    // Nothing fresh to hide — and crucially `last` is not overwritten with an
    // empty act, or the undo below would have nothing to give back.
    expect(second.hidden).toEqual([]);
    const list = await (await request.get("/api/immich/hidden")).json();
    expect(list.ids.filter((id) => id === UUID_A)).toHaveLength(1);
  });
});

// ── On the page ─────────────────────────────────────────────────────────────

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const portrait = (id, iso) => ({
  id,
  aspect: 0.75,
  localDateTime: iso,
  city: "Nudgee",
  country: "Australia",
  people: []
});

/** Boot V3 with a fixture pool and the veto POST captured rather than stored. */
async function bootV3(page, { diptych = false, photoVeto = true, pool } = {}) {
  const posted = [];
  page.on("pageerror", (e) => { throw e; });

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        "\nwindow.CONFIG.features.groundMemories = true;" +
        `\nwindow.CONFIG.features.groundDiptych = ${diptych};` +
        `\nwindow.CONFIG.features.photoVeto = ${photoVeto};\n`
    });
  });
  /* ⚠ THE STUB FILTERS, because the real server does — the veto lives in
     immichClient's usableImage, so a re-fetched pool never carries a hidden id.
     A stub that kept serving them would fail the walk below for a reason that
     cannot happen in production, and "fixing" that by weakening the assertion
     would have thrown away the only test of the client's half. */
  const hidden = new Set();
  await page.route("**/api/immich/on-this-day", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ assets: pool.filter((a) => !hidden.has(a.id)) })
    })
  );
  await page.route("**/api/immich/asset/*/thumb", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG })
  );
  // Captured, so a spec never writes to the real hidden list.
  await page.route("**/api/immich/hidden", async (route, req) => {
    const body = JSON.parse(req.postData() ?? "{}");
    posted.push(body);
    for (const id of body.ids ?? []) hidden.add(id);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ hidden: [], total: 0, persisted: true })
    });
  });

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__groundVeto === "function");
  await expect
    .poll(() => page.evaluate(() => window.__ground().shown), { timeout: 10_000 })
    .toBe(true);
  return posted;
}

test("a veto hides the photograph on the glass and moves on", async ({ page }) => {
  const pool = ["a", "b", "c", "d"].map((id, i) =>
    portrait(id, `2013-08-13T0${6 + i}:00:00Z`)
  );
  const posted = await bootV3(page, { pool });

  const before = await page.evaluate(() => window.__ground().assetIds);
  const result = await page.evaluate(() => window.__groundVeto());

  expect(result.hidden).toEqual(before);
  expect(posted).toEqual([{ ids: before }]);

  // The wall does not sit on the photograph it was just told to stop showing.
  await expect
    .poll(() => page.evaluate(() => window.__ground().assetIds[0]), { timeout: 10_000 })
    .not.toBe(before[0]);
});

test("⚠ a vetoed photograph cannot come back today — the pool is drawn ONCE a day", async ({ page }) => {
  /* The server list alone does not cover this: today's frames are already in
     memory, so without dropping them locally the rejected photograph keeps
     coming round until midnight — which looks exactly like the veto failing. */
  const pool = ["a", "b", "c", "d"].map((id, i) =>
    portrait(id, `2013-08-13T0${6 + i}:00:00Z`)
  );
  await bootV3(page, { pool });

  const vetoed = await page.evaluate(() => window.__ground().assetIds[0]);
  await page.evaluate(() => window.__groundVeto());

  /* ⚠ The veto answers with a BRISK cross-fade, not the ambient sixty-second
     one — this poll is what caught that. On the ambient timing the rejected
     photograph was still the ground a full minute after being told to go,
     which reads as the house ignoring the room. */
  await expect
    .poll(() => page.evaluate(() => window.__ground().assetIds[0]), { timeout: 5_000 })
    .not.toBe(vetoed);

  const seen = await page.evaluate(async () => {
    const ids = [];
    for (let i = 0; i < 8; i++) {
      ids.push(window.__ground().assetIds[0]);
      await window.__groundDissolve(60);
      await new Promise((r) => setTimeout(r, 200));
    }
    return ids;
  });

  // Walks past the end of a four-frame pool, so it also covers the re-fetch —
  // the moment the client's own memory of the veto has run out and only the
  // server's list is holding it.
  expect(seen).not.toContain(vetoed);

  /* ⚠ And the DOM does not grow while doing it. `layers` climbing during a
     fast walk is EXPECTED and is not a leak: each settle schedules its own
     removal at settleMs + 2000ms, so a loop that dissolves every 200ms is
     measuring a backlog of pending removals. Waiting past the buffer is the
     difference between reading a queue and reading a leak. */
  await expect
    .poll(() => page.evaluate(() => window.__ground().layers), { timeout: 10_000 })
    .toBe(1);
});

/* ── "This one" means what is ON THE GLASS, and that is two different things ──
   ⚠⚠ THE WHOLE-FRAME RULE'S PREMISE EXPIRED ON 2026-08-22. It was "the room is
   looking at both halves and pointing at neither", which is still exactly true
   of the FULL-BLEED diptych at depths 1-3 and became false at depth 0 the day
   the archive card stopped holding two prints. Both halves of that split are
   pinned below, because either one alone would look like the whole rule. */

const DIPTYCH_POOL = () => [
  portrait("p1", "2013-08-13T06:00:00Z"),
  portrait("p2", "2013-08-13T07:00:00Z")
];

test("on the archive card, ONE photograph is vetoed — not its unseen partner", async ({ page }) => {
  /* The card holds one at a time now, so the room is looking at exactly one and
     pointing at it. Hiding the pair would delete a picture nobody rejected and
     nobody had even seen yet — and the wall would say "both of those, gone for
     good" over a card showing one, which is the house describing something the
     room cannot see. */
  const posted = await bootV3(page, { diptych: true, pool: DIPTYCH_POOL() });

  const shown = await page.evaluate(() => window.__ground());
  // ⚠ ground STILL PAIRS. Lose this and the test below is measuring the diptych
  // being switched off rather than the card presenting one half of it.
  expect(shown.pair).toBe(true);

  // The archive is the surface, and it is showing half one.
  const onCard = await page.evaluate(() => window.__archiveFocus());
  expect(onCard).toBe("p1");

  const result = await page.evaluate(() => window.__groundVeto());
  expect(result.hidden).toEqual(["p1"]);
  expect(posted[0].ids).toEqual(["p1"]);

  /* `pair` false is what makes the VOICE honest without a second decision — it
     is derived from what was hidden, so `handlePhotoVeto` speaks the singular
     line on its own. */
  expect(result.pair).toBe(false);
});

test("⚠⚠ vetoing while HALF TWO holds the card hides half two, not half one", async ({ page }) => {
  /* THE ASSERTION THE OBVIOUS TEST MISSES. A focus that returned `assets[0]`
     instead of `assets[heldIndex]` passes every other test in this file — the
     card shows half one for the first five minutes of a frame, so a veto in
     that window cannot tell the two apart. It would then quietly hide the
     photograph the room is NOT looking at while leaving the one it just
     rejected on the glass, which is the veto's worst possible failure. */
  const pool = [
    portrait("p1", "2013-08-13T06:00:00Z"),
    portrait("p2", "2013-08-13T07:00:00Z"),
    portrait("q1", "2016-08-13T06:00:00Z"),
    portrait("q2", "2016-08-13T07:00:00Z")
  ];
  const posted = await bootV3(page, { diptych: true, pool });

  /* Half a rotation is five minutes on the wall. The lever takes effect on the
     NEXT frame, so the dissolve is what actually exercises it — and with a pool
     of two pairs the next frame is always the other pair, never the same key. */
  await page.evaluate(() => window.__archiveHalfHold(300));
  await page.evaluate(() => window.__groundDissolve(60, 200));
  await expect
    .poll(() => page.evaluate(() => window.__archive().half), { timeout: 10_000 })
    .toBe(1);

  const onCard = await page.evaluate(() => window.__archiveFocus());
  // Pairing sorts each year's group by time, so half two is the later frame.
  expect(onCard).toMatch(/2$/);

  const result = await page.evaluate(() => window.__groundVeto());
  expect(result.hidden).toEqual([onCard]);
  expect(posted[0].ids).toEqual([onCard]);
  expect(result.pair).toBe(false);
});

test("⚠ at depth 1 the FULL-BLEED diptych is still vetoed WHOLE", async ({ page }) => {
  /* The archive recedes above depth 0 and both halves really are on the glass,
     so the original rule is still the right one here. This is the half of the
     split that a change to `archiveFocusId()` could silently take with it. */
  const posted = await bootV3(page, { diptych: true, pool: DIPTYCH_POOL() });

  await page.evaluate(() => window.__setDepth(1, "spec"));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.depth))
    .toBe("1");
  // No focus at all — "hide the frame whole" is the answer, not a fallback.
  expect(await page.evaluate(() => window.__archiveFocus())).toBeNull();

  const result = await page.evaluate(() => window.__groundVeto());
  expect(result.pair).toBe(true);
  expect(result.hidden).toHaveLength(2);
  expect(posted[0].ids).toHaveLength(2);
});

/* ── Through the actual voice turn ───────────────────────────────────────────
   The tests above drive `__groundVeto` directly, which skips the half that can
   silently break: matching, the flag, and the handler that ties them to the
   ground. `__v3Transcript` is the real `submit()`, so these two cover the whole
   chain from a spoken sentence to a POST. */

test("saying it works end to end — the sentence reaches the list", async ({ page }) => {
  const pool = ["a", "b", "c"].map((id, i) => portrait(id, `2013-08-13T0${6 + i}:00:00Z`));
  const posted = await bootV3(page, { pool });

  const before = await page.evaluate(() => window.__ground().assetIds);
  const turn = await page.evaluate(() => window.__v3Transcript("not this one"));

  expect(turn).toMatchObject({ handled: true, lane: "local" });
  expect(posted).toEqual([{ ids: before }]);
});

test("flag off: the same sentence posts NOTHING and is not handled locally", async ({ page }) => {
  /* The rollback, and it needs stating precisely: the intent still MATCHES,
     because the matcher is pure and shared with the incumbent. The guarantee is
     that the handler refuses, the turn falls THROUGH to the next lane exactly
     as it did before this existed, and the hidden list can never be written. */
  const pool = ["a", "b"].map((id, i) => portrait(id, `2013-08-13T0${6 + i}:00:00Z`));
  const posted = await bootV3(page, { photoVeto: false, pool });

  const before = await page.evaluate(() => window.__ground().assetIds[0]);
  const turn = await page.evaluate(() => window.__v3Transcript("not this one"));

  expect(turn?.lane).not.toBe("local");
  expect(posted).toEqual([]);
  // And the photograph it was told to hide is still there.
  expect(await page.evaluate(() => window.__ground().assetIds[0])).toBe(before);
});

