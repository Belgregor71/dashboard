import { test, expect } from "@playwright/test";
import {
  WRITABLE_LISTS,
  INVERSE_VERB,
  resolveList,
  extractItems,
  findItem,
  openItems,
  summaryOf,
  decideOutcome
} from "../server/services/listWrites.js";
import { SAFE_SERVICES } from "../server/ha/haRoutes.js";
import { matchIntent } from "../src/js/services/localIntents.js";
import { bootV3 } from "./fixtures/v3boot.js";

/* The list write lane (docs/AUGUST-IMPROVEMENTS.md §3) — pure-node tests of the
   half that decides what a write MEANT.

   ⚠ THE THING UNDER TEST IS AN HONESTY GUARD, so every test below is written
   against a SPECIFIC WRONG ANSWER rather than against "does it work". The wrong
   answers that matter are the two this repo has already been given by its own
   code: a service call that did not throw reported as a change that happened
   (the floodlight, docs/BACKLOG.md:722-729), and a fetch that failed reported as
   a thing that is empty (the photo archive, 23b789b). Both are single branches
   here and both have a test that names them. */

const OPEN = (summary) => ({ summary, status: "needs_action" });
const DONE = (summary) => ({ summary, status: "completed" });

/* The exact bytes the live house answered on 2026-08-30. Written out rather
   than hand-shaped: the browser-side twin of extractItems guessed at four
   spellings, none of them this one, and returned [] for all of them — so the
   wall reported every to-do list as empty regardless of what was on it. A
   fixture invented from the reader's assumptions cannot catch that. */
const LIVE_PAYLOAD = {
  changed_states: [],
  service_response: {
    "todo.both": {
      items: [
        { summary: "Buy swimwear", uid: "52e7", status: "completed", completed: "2026-03-28T04:39:44+00:00" },
        { summary: "Feed fish", uid: "f32a", status: "needs_action" },
        { summary: "Water plants", uid: "ffb6", status: "needs_action" }
      ]
    }
  }
};

test.describe("the readback shape", () => {
  test("reads the live service_response payload", () => {
    const items = extractItems(LIVE_PAYLOAD, "todo.both");
    expect(items?.map(summaryOf)).toEqual(["Buy swimwear", "Feed fish", "Water plants"]);
    expect(openItems(items).map(summaryOf)).toEqual(["Feed fish", "Water plants"]);
  });

  test("⚠ a shape it cannot read is null, NOT an empty list", () => {
    /* The defect: `return []`. It is the same one line that made the wall say
       "the shopping list is empty" with total confidence, and it cannot be
       caught downstream because by then the failure looks exactly like a list
       with nothing on it. decideOutcome turns null into "unknown" and [] into
       "it did not take" — two different sentences out of the speaker. */
    expect(extractItems({ changed_states: [] }, "todo.both")).toBeNull();
    expect(extractItems(null, "todo.both")).toBeNull();
    expect(extractItems({ service_response: {} }, "todo.both")).toBeNull();
    expect(extractItems({ service_response: { "todo.greg": { items: [] } } }, "todo.both")).toBeNull();

    // …and a list that really is empty still reads as one.
    expect(extractItems({ service_response: { "todo.both": { items: [] } } }, "todo.both")).toEqual([]);
  });

  test("the shapes HA's other todo integrations answer with still read", () => {
    expect(extractItems([OPEN("Bread")], "todo.both")?.map(summaryOf)).toEqual(["Bread"]);
    expect(extractItems({ response: { "todo.both": { items: [OPEN("Bread")] } } }, "todo.both")?.map(summaryOf))
      .toEqual(["Bread"]);
    expect(extractItems({ items: [OPEN("Bread")] }, "todo.both")?.map(summaryOf)).toEqual(["Bread"]);
  });

  test("the item label is read from whichever key the integration used", () => {
    expect(summaryOf({ summary: "A" })).toBe("A");
    expect(summaryOf({ name: "B" })).toBe("B");
    expect(summaryOf({ title: "C" })).toBe("C");
  });
});

test.describe("finding the thing the room meant", () => {
  const items = [OPEN("Sourdough bread"), OPEN("Milk"), DONE("Oat milk")];

  test("exact beats substring", () => {
    // "milk" must reach Milk, not Oat milk — a substring rule with no exact
    // pass first would tick off whichever happened to be earlier in the array.
    expect(summaryOf(findItem(items, "milk").item)).toBe("Milk");
    expect(summaryOf(findItem(items, "MILK ").item)).toBe("Milk");
  });

  test("a substring reaches the longer name", () => {
    expect(summaryOf(findItem(items, "bread").item)).toBe("Sourdough bread");
  });

  test("⚠ two matches is ambiguous, never a guess", () => {
    const got = findItem([OPEN("Oat milk"), OPEN("Milk chocolate")], "milk");
    expect(got.item).toBeUndefined();
    expect(got.ambiguous).toEqual(["Oat milk", "Milk chocolate"]);
  });

  test("nothing matching is null, and so is an empty phrase", () => {
    expect(findItem(items, "quinoa")).toBeNull();
    expect(findItem(items, "   ")).toBeNull();
  });
});

test.describe("what the re-read proved", () => {
  test("add: present afterwards is the only thing that confirms it", () => {
    expect(decideOutcome({
      verb: "add", item: "bread", wrote: true, fetchOk: true,
      itemsAfter: [OPEN("Sourdough bread"), OPEN("Milk")]
    })).toEqual({ ok: true, state: "confirmed", count: 2, items: ["Sourdough bread", "Milk"] });
  });

  test("⚠⚠ add: the write returned and the item is NOT there — this is a FAILURE", () => {
    /* THE WHOLE REASON THIS MODULE EXISTS. `runToolCall` reports "done" from a
       haPost that did not throw, and on exactly that basis the house said
       "backyard light's on now" while the light stayed off. A no-op success
       walks straight past a "never pretend you did it" rule written for
       refusals, so it has to be caught by looking, not by asking. */
    const got = decideOutcome({
      verb: "add", item: "bread", wrote: true, fetchOk: true, itemsAfter: [OPEN("Milk")]
    });
    expect(got.ok).toBe(false);
    expect(got.state).toBe("not-on-list");
    expect(got.count).toBe(1);
  });

  test("⚠⚠ a failed re-read is UNKNOWN, never 'it did not take'", () => {
    /* The defect: treating null itemsAfter as an empty list. That reports a
       write that probably DID land as a failure, out loud, every time Home
       Assistant is briefly unreachable — and "that didn't take" is a sentence
       that makes someone add the item twice. */
    for (const itemsAfter of [null, undefined]) {
      expect(decideOutcome({ verb: "add", item: "bread", wrote: true, fetchOk: false, itemsAfter }))
        .toEqual({ ok: false, state: "unknown", count: null, items: [] });
    }
  });

  test("a write that threw is unknown too, and reads back nothing", () => {
    expect(decideOutcome({ verb: "add", item: "bread", wrote: false, fetchOk: true, itemsAfter: [] }).state)
      .toBe("unknown");
  });

  test("add: a genuinely empty list afterwards IS a failure", () => {
    // The mirror of the test above, and the reason the two must not be merged:
    // [] with a good fetch is a real answer about a real list.
    expect(decideOutcome({ verb: "add", item: "bread", wrote: true, fetchOk: true, itemsAfter: [] }))
      .toEqual({ ok: false, state: "not-on-list", count: 0, items: [] });
  });

  test("complete: gone from the OPEN items is what confirms it", () => {
    expect(decideOutcome({
      verb: "complete", item: "bread", wrote: true, fetchOk: true,
      itemsAfter: [DONE("Sourdough bread"), OPEN("Milk")]
    })).toMatchObject({ ok: true, state: "confirmed", count: 1 });

    // Still open afterwards: update_item answered and nothing moved.
    expect(decideOutcome({
      verb: "complete", item: "bread", wrote: true, fetchOk: true,
      itemsAfter: [OPEN("Sourdough bread")]
    })).toMatchObject({ ok: false, state: "not-on-list" });
  });

  test("⚠ remove is judged against EVERY item, not the open ones", () => {
    /* The defect this names: judging a removal the way a completion is judged.
       An item that was ticked off instead of deleted is absent from the open
       list and present on the list — so a removal that silently degraded into a
       completion would be confirmed, and the thing the room asked to delete
       would still be sitting there. */
    expect(decideOutcome({
      verb: "remove", item: "bread", wrote: true, fetchOk: true, itemsAfter: [DONE("Sourdough bread")]
    })).toMatchObject({ ok: false, state: "not-on-list" });

    expect(decideOutcome({
      verb: "remove", item: "bread", wrote: true, fetchOk: true, itemsAfter: [OPEN("Milk")]
    })).toMatchObject({ ok: true, state: "confirmed", count: 1 });
  });

  test("the count the wall speaks is the OPEN count", () => {
    // "four things on it now" must not include the ones already ticked off, or
    // the sentence disagrees with the panel rendered underneath it.
    const got = decideOutcome({
      verb: "add", item: "bread", wrote: true, fetchOk: true,
      itemsAfter: [OPEN("Sourdough bread"), DONE("Milk"), DONE("Sugar")]
    });
    expect(got.count).toBe(1);
    expect(got.items).toEqual(["Sourdough bread"]);
  });
});

test.describe("the bound on what this lane may touch", () => {
  test("two lists, and the personal ones are unreachable BY CONSTRUCTION", () => {
    expect(Object.keys(WRITABLE_LISTS).sort()).toEqual(["household", "shopping"]);
    expect(resolveList("shopping").entityId).toBe("todo.shopping_list");
    expect(resolveList("household").entityId).toBe("todo.both");
  });

  test("⚠ an entity id is not a key, and neither is anything else", () => {
    /* Verify a guard by making it FAIL. The vacuous version of this test asks
       "does resolveList accept the two keys" — which passes against a resolver
       that accepts everything (project-voice-tool-lane records the same trap
       costing a session). These are the inputs that must be REFUSED, including
       the two real entity ids of the house's private lists. */
    for (const key of ["todo.greg", "todo.brett", "todo.shopping_list", "greg", "", null, undefined, "__proto__", "toString"]) {
      expect(resolveList(key), String(key)).toBeNull();
    }
  });

  test("⚠ todo.* is deliberately NOT in SAFE_SERVICES", () => {
    /* SAFE_SERVICES gates the generic /api/ha/services proxy AND the Claude tool
       lane, which both take an entity_id from the caller. Adding todo.add_item
       there would hand every todo entity in the house — including todo.greg and
       todo.brett — to two lanes that have no roster of their own for them. This
       lane carries its own narrower allowlist instead, so a future widening of
       SAFE_SERVICES has to be a deliberate act with this test in front of it. */
    expect([...SAFE_SERVICES].filter((s) => s.startsWith("todo."))).toEqual([]);
  });

  test("every write has an inverse, because speech misfires", () => {
    expect(INVERSE_VERB.add).toBe("remove");
    expect(INVERSE_VERB.remove).toBe("add");
    expect(INVERSE_VERB.complete).toBe("uncomplete");
  });
});

test.describe("the phrasings that reach this lane", () => {
  const withFlag = (on, fn) => {
    const prior = globalThis.window;
    try {
      globalThis.window = { CONFIG: { features: { voiceListWrites: on } } };
      fn();
    } finally {
      if (prior === undefined) delete globalThis.window;
      else globalThis.window = prior;
    }
  };

  test("the three verbs, and which list each names", () => {
    withFlag(true, () => {
      expect(matchIntent("add oat milk to the shopping list"))
        .toEqual({ id: "list.add", slots: { list: "shopping", item: "oat milk", named: true } });
      expect(matchIntent("put bread on the list")).toMatchObject({ id: "list.add", slots: { item: "bread" } });
      expect(matchIntent("add feed the fish to the house list"))
        .toMatchObject({ id: "list.add", slots: { list: "household", item: "feed the fish" } });
      expect(matchIntent("take bread off the shopping list")).toMatchObject({ id: "list.remove", slots: { item: "bread" } });
      expect(matchIntent("remove bread from the list")).toMatchObject({ id: "list.remove" });
      expect(matchIntent("cross off the bread")).toMatchObject({ id: "list.complete", slots: { item: "bread" } });
      expect(matchIntent("cross the bread off the list")).toMatchObject({ id: "list.complete", slots: { item: "bread" } });
      expect(matchIntent("we got the milk")).toMatchObject({ id: "list.complete", slots: { item: "milk" } });
    });
  });

  test("⚠ `named` is what decides whether a failure is spoken", () => {
    withFlag(true, () => {
      // "take bread off the shopping list" that finds no bread deserves an
      // honest answer; "we got the milk" said about anything else at all must
      // fall through in silence. The handler cannot tell them apart without it.
      expect(matchIntent("take bread off the shopping list").slots.named).toBe(true);
      expect(matchIntent("we got the milk").slots.named).toBe(false);
      expect(matchIntent("cross off the bread").slots.named).toBe(false);
    });
  });

  test("⚠ PRECEDENCE: a photograph is still a photograph", () => {
    withFlag(true, () => {
      // These open with the same verbs the remove pattern uses and must not be
      // read as list instructions — the veto is the only lane that can act on
      // them at all.
      expect(matchIntent("not this one").id).toBe("photo.veto");
      expect(matchIntent("delete this photo").id).toBe("photo.veto");
      expect(matchIntent("remove that picture").id).toBe("photo.veto");
      expect(matchIntent("get rid of this one").id).toBe("photo.veto");
    });
  });

  test("⚠ PRECEDENCE: the undo splits on whether a list was named", () => {
    withFlag(true, () => {
      // PHOTO_RESTORE_RE matches a bare "put that back", so the list-scoped undo
      // has to be tested BEFORE it or it can never be reached.
      expect(matchIntent("put it back on the list").id).toBe("list.undo");
      expect(matchIntent("put it back on the shopping list").id).toBe("list.undo");
      expect(matchIntent("put that back").id).toBe("photo.restore");
      expect(matchIntent("bring back that photo")).toMatchObject({ id: "photo.restore", slots: { scope: "photo" } });
      expect(matchIntent("undo that")).toMatchObject({ id: "photo.restore", slots: { scope: "last" } });
    });
  });

  test("⚠ a verb with no object never reaches the house", () => {
    withFlag(true, () => {
      // "take that off the list" names nothing findable, and a lane that
      // guessed which item was meant is a lane nobody can trust with a delete.
      expect(matchIntent("take that off the list")?.id).not.toBe("list.remove");
      expect(matchIntent("add it to the list")?.id).not.toBe("list.add");
    });
  });

  test("⚠ still bounded: an utterance that names no list goes to Assist", () => {
    withFlag(true, () => {
      // Assist owns the lists and handles most of these; the local lane only
      // claims the ones it can afterwards CHECK. "we got a new car" is the
      // article test on the cross-off family.
      expect(matchIntent("add milk")).toBeNull();
      expect(matchIntent("we got a new car")).toBeNull();
      expect(matchIntent("turn on the backyard light")).toBeNull();
    });
  });

  test("⚠ flag off: not one of these matches, so no request can be made", () => {
    withFlag(false, () => {
      expect(matchIntent("add oat milk to the shopping list")).toBeNull();
      expect(matchIntent("we got the milk")).toBeNull();
      expect(matchIntent("cross off the bread")).toBeNull();
      // …and the two utterances that meant something BEFORE this lane existed
      // still mean exactly that.
      expect(matchIntent("put it back on the list").id).toBe("photo.restore");
      expect(matchIntent("take bread off the shopping list").id).toBe("list.shopping");
    });
  });
});

/* ── On the wall ────────────────────────────────────────────────────────────
   The pure half above proves the SERVER cannot be fooled. This half proves the
   WALL repeats what the server found rather than what it hoped for — which is
   the half that was missing when the house announced a light it had not turned
   on, and it is a different failure living in a different file. */
test.describe("wired to the wall", () => {
  const REPLY = {
    confirmed: {
      list: "shopping", label: "shopping list", item: "oat milk",
      ok: true, state: "confirmed", count: 3, items: ["Bread", "Milk", "oat milk"]
    },
    notOnList: {
      list: "shopping", label: "shopping list", item: "oat milk",
      ok: false, state: "not-on-list", count: 2, items: ["Bread", "Milk"]
    },
    unknown: {
      list: "shopping", label: "shopping list", item: "oat milk",
      ok: false, state: "unknown", count: null, items: []
    },
    noSuchItem: {
      list: "shopping", label: "shopping list", item: "milk",
      ok: false, state: "no-such-item", count: null, items: ["Bread"]
    }
  };

  async function turn(page, said) {
    return page.evaluate((t) => window.__v3Transcript(t), said);
  }

  const saidText = (page) => page.locator("#glance-said").textContent();

  test("⚠ flag off: the utterance never reaches the house", async ({ page }) => {
    // The rollback path, asserted on the REQUEST rather than on the words —
    // the matcher is pure and shared with the incumbent, so "did it speak" is
    // the wrong question. Nothing may be posted at all.
    const posted = [];
    page.on("request", (r) => { if (r.url().includes("/api/lists")) posted.push(r.url()); });

    const { pageErrors } = await bootV3(page, { "/api/lists": REPLY.confirmed });
    const res = await turn(page, "add oat milk to the shopping list");

    expect(posted).toEqual([]);
    expect(res.lane).not.toBe("local");
    expect(pageErrors).toEqual([]);
  });

  test("⚠⚠ flag off: a bare 'undo that' does not go looking for a list either", async ({ page }) => {
    /* THE PATH THE MATCHER DOES NOT GUARD. Every other utterance is stopped by
       matchIntent refusing to claim it, so the handler's own flag check looks
       like belt and braces — and it is not. "Undo that" is claimed by
       photo.restore whether this lane exists or not, and the restore branch
       asks the list first because a bare undo means whichever change happened
       last. With the handler's guard removed that becomes a POST to /api/lists
       on every "undo that" ever said to a wall with this flag OFF.

       ⚠ Found by injecting the defect: deleting that guard left the whole file
       green, which is what a test that does not reach the code looks like. */
    const posted = [];
    page.on("request", (r) => { if (r.url().includes("/api/lists")) posted.push(r.url()); });

    await bootV3(page, { "/api/lists": REPLY.confirmed });
    await turn(page, "undo that");

    expect(posted, "the list lane was asked while its flag was off").toEqual([]);
  });

  test("a confirmed write is spoken AND put on the glass", async ({ page }) => {
    const { pageErrors } = await bootV3(page, { "/api/lists": REPLY.confirmed }, {
      features: { voiceListWrites: true }
    });
    const res = await turn(page, "add oat milk to the shopping list");

    expect(res).toMatchObject({ handled: true, lane: "local" });
    expect(await saidText(page)).toContain("oat milk is on the shopping list");
    expect(await saidText(page)).toContain("3 things");

    // The list itself, showing the items the SERVER read back — the strongest
    // confirmation this surface can give, and the one a stale entity cache
    // would quietly get wrong.
    await expect(page.locator('[data-cell="shopping"]')).toBeVisible();
    await expect(page.locator('[data-cell="shopping"]')).toContainText("oat milk");
    expect(await page.evaluate(() => window.__depth().depth)).toBe(3);
    expect(pageErrors).toEqual([]);
  });

  test("⚠⚠ the write reported success and the list disagreed — the wall SAYS SO", async ({ page }) => {
    /* THE TEST THIS FEATURE EXISTS FOR. Everything upstream of the wall can be
       correct and this still be a lie: the server can hand back an honest
       `not-on-list` and the browser can say "added" anyway, because "the POST
       resolved" is the easiest thing in the world to treat as success. */
    const { pageErrors } = await bootV3(page, { "/api/lists": REPLY.notOnList }, {
      features: { voiceListWrites: true }
    });
    await turn(page, "add oat milk to the shopping list");

    const said = await saidText(page);
    expect(said).toContain("didn't take");
    expect(said).toContain("2 things");
    expect(said.toLowerCase()).not.toContain("is on the shopping list");
    expect(said.toLowerCase()).not.toContain("added");
    expect(pageErrors).toEqual([]);
  });

  test("a house it cannot reach is said differently from a write that failed", async ({ page }) => {
    const { pageErrors } = await bootV3(page, { "/api/lists": REPLY.unknown }, {
      features: { voiceListWrites: true }
    });
    await turn(page, "add oat milk to the shopping list");

    const said = await saidText(page);
    expect(said).toContain("can't reach the shopping list");
    // ⚠ Not "didn't take". A write that probably DID land, reported as a
    // failure, is what makes someone add the same thing twice.
    expect(said).not.toContain("didn't take");
    expect(pageErrors).toEqual([]);
  });

  test("⚠ an utterance that named no list fails in SILENCE", async ({ page }) => {
    /* "We got the milk" might be about the list and might be about anything at
       all. When the list has no milk on it the honest move is to say nothing
       and let the next lane have the sentence — the same courtesy the
       photograph veto pays a wall with no photograph on it. */
    const { pageErrors } = await bootV3(page, { "/api/lists": REPLY.noSuchItem }, {
      features: { voiceListWrites: true }
    });
    const res = await turn(page, "we got the milk");

    expect(res.lane).not.toBe("local");
    expect(await saidText(page)).not.toContain("no milk on the");
    expect(pageErrors).toEqual([]);
  });

  test("…and the same failure IS spoken when the room named the list", async ({ page }) => {
    const { pageErrors } = await bootV3(page, { "/api/lists": REPLY.noSuchItem }, {
      features: { voiceListWrites: true }
    });
    await turn(page, "take milk off the shopping list");

    expect(await saidText(page)).toContain("no milk on the shopping list");
    expect(pageErrors).toEqual([]);
  });
});
