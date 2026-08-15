import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { buildIndex } from "../server/services/vaultIndex.js";
import { labelPeople, __resetRoster } from "../server/services/photoNames.js";

/* What the ambient ground is allowed to call the people in a photograph
   (server/services/photoNames.js).

   This lane exists because the vault's relationship map reached the glass only
   through /api/immich/daily-set, which V3 never fetches — so "our niece
   Melanie" was being indexed every ten minutes and read by nobody. These are
   node-side unit tests: labelPeople is pure apart from the module-level vault
   index, which beforeEach rebuilds from the fixture.

   ⚠ The roster (Immich's people list, which tells displayName WHICH given names
   are shared) is never available here — Immich is unconfigured in the suite, so
   fetchPeopleNames answers []. That means every test below runs in the
   documented COLD-ROSTER state, where the rule is "qualify every name": full
   names, never bare given ones. That is the behaviour worth pinning anyway,
   because it is what the Pi does for the first request after every restart and
   whenever the NAS is asleep. */

const FIXTURE_VAULT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "vault"
);

const HIDDEN = "Greg Dee,Brett Lewis";

// The lane's three conditions, all on. Saved and restored per test so a spec
// that turns one off cannot leak into the next.
function laneOn() {
  process.env.IMMICH_CAPTION_HIDE_NAMES = HIDDEN;
  process.env.IMMICH_CAPTION_RELATIONSHIPS = "1";
  process.env.VAULT_ENABLED = "1";
}

const asset = (people, extra = {}) => ({
  id: "a1",
  localDateTime: "2023-08-12T19:13:52.378Z",
  city: "Nudgee",
  people,
  ...extra
});

let saved;

test.beforeEach(async () => {
  saved = {
    hide: process.env.IMMICH_CAPTION_HIDE_NAMES,
    rel: process.env.IMMICH_CAPTION_RELATIONSHIPS,
    vault: process.env.VAULT_ENABLED
  };
  __resetRoster();
  // vault.spec.js's last buildIndex points at a directory that does not exist,
  // and the index is module-level — so rebuild per test rather than once.
  await buildIndex(FIXTURE_VAULT);
  laneOn();
});

test.afterEach(() => {
  for (const [key, value] of [
    ["IMMICH_CAPTION_HIDE_NAMES", saved.hide],
    ["IMMICH_CAPTION_RELATIONSHIPS", saved.rel],
    ["VAULT_ENABLED", saved.vault]
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test.describe("OFF ⇒ identity — the rollback path", () => {
  /* Each of the three conditions is a rollback on its own (edit the G11's .env,
     restart). Asserted as the SAME ARRAY, not merely a deep-equal one: an
     identity return is what proves no work happened, and it is what keeps the
     route's memoised assets untouched. */
  const cases = [
    ["the relationships flag is off", () => { process.env.IMMICH_CAPTION_RELATIONSHIPS = "0"; }],
    ["the vault lane is off", () => { delete process.env.VAULT_ENABLED; }],
    ["nobody is hidden", () => { delete process.env.IMMICH_CAPTION_HIDE_NAMES; }]
  ];

  for (const [label, turnOff] of cases) {
    test(`untouched when ${label}`, () => {
      turnOff();
      const assets = [asset(["Melanie Sweet"])];
      expect(labelPeople(assets)).toBe(assets);
      expect(assets[0].people).toEqual(["Melanie Sweet"]);
    });
  }

  /* The nobody-hidden case is the one that would have bitten. nameSegment reads
     an empty hide-list as "names are off" and returns "" for everyone
     (photoMemory.js:228), so without that guard turning this lane ON would have
     REMOVED the names the ground shows today — a regression dressed as a
     feature. */
  test("an empty hide-list never blanks the names it was meant to enrich", () => {
    process.env.IMMICH_CAPTION_HIDE_NAMES = "";
    expect(labelPeople([asset(["Melanie Sweet"])])[0].people).toEqual(["Melanie Sweet"]);
  });
});

test.describe("ON — the vault's own words", () => {
  test("one person alone gets what the house calls them", () => {
    expect(labelPeople([asset(["Melanie Sweet"])])[0].people).toEqual(["our niece Melanie"]);
  });

  /* A relationship label drops back to the GIVEN name — "our niece Melanie" is
     unmistakable and "our niece Melanie Sweet" is just long. It is the one place
     the cold roster does not force a full name. */
  test("a labelled name is a given name even when every name is being qualified", () => {
    expect(labelPeople([asset(["Symon Dee"])])[0].people).toEqual(["our nephew Symon"]);
  });

  /* nameSegment's rule, not ours: the label is a warm aside when someone has the
     photograph to themselves, and an inventory when there are two of them. */
  test("two people are named, not labelled", () => {
    expect(labelPeople([asset(["Melanie Sweet", "Mark Weber"])])[0].people)
      .toEqual(["Melanie Sweet and Mark Weber"]);
  });

  test("someone the vault has never heard of keeps their plain name", () => {
    expect(labelPeople([asset(["Korina Newsome-Smith"])])[0].people)
      .toEqual(["Korina Newsome-Smith"]);
  });

  /* The residents are in the overwhelming majority of named-face photographs.
     Naming them would caption nearly every photo with whoever is standing in
     front of the screen, which is the one thing they already know. */
  test("the two residents are never named, and leave nothing behind", () => {
    expect(labelPeople([asset(["Greg Dee"])])[0].people).toEqual([]);
    expect(labelPeople([asset(["Brett Lewis", "Greg Dee"])])[0].people).toEqual([]);
  });

  test("a resident beside a guest leaves only the guest", () => {
    expect(labelPeople([asset(["Greg Dee", "Melanie Sweet"])])[0].people)
      .toEqual(["our niece Melanie"]);
  });

  test("an unnamed photograph passes straight through", () => {
    const assets = [asset([]), { id: "b", localDateTime: null }];
    const out = labelPeople(assets);
    expect(out[0]).toBe(assets[0]);
    expect(out[1]).toBe(assets[1]);
  });

  /* ⚠ The route memoises on-this-day for an hour and labels on the way OUT, so
     every response shares one cached array. A labeller that wrote through would
     poison the cache with the first request's phrasing and there would be no
     way back short of a restart. */
  test("never mutates the assets it was given", () => {
    const assets = [asset(["Melanie Sweet"])];
    const out = labelPeople(assets);
    expect(assets[0].people).toEqual(["Melanie Sweet"]);
    expect(out[0]).not.toBe(assets[0]);
    expect(out[0].city).toBe("Nudgee");
    expect(out[0].localDateTime).toBe(assets[0].localDateTime);
  });

  test("an empty feed is not an error", () => {
    expect(labelPeople([])).toEqual([]);
    expect(labelPeople(null)).toEqual([]);
    expect(labelPeople(undefined)).toEqual([]);
  });
});
