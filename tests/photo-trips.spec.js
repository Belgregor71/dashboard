import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { buildIndex } from "../server/services/vaultIndex.js";
import { labelTrips } from "../server/services/photoTrips.js";

/* What the ambient ground is allowed to call the OCCASION a photograph belonged
   to (server/services/photoTrips.js).

   Stage 1 (photo-names.spec.js) gave the wall the vault's PEOPLE. This is the
   vault's DATES — the half with reach, because a trip covers every photograph
   taken inside it whether or not anyone's face was recognised. Measured on the
   live G11 2026-08-15: of 100 on-this-day assets, 4 carried a named face and 24
   fell inside a single trip span.

   Node-side unit tests. labelTrips is pure apart from the module-level vault
   index, which beforeEach rebuilds from the fixture (tests/fixtures/vault/
   trips/tasmania-2019.md — 2019-10-04 to 2019-10-14, label "Tasmania").

   ⚠ The suite can never exercise the route end of this: Immich is unconfigured
   on a dev box, so /api/immich/on-this-day returns { assets: [] } before
   labelTrips is ever reached. These are the only coverage; live proof is owed
   on the wall. */

const FIXTURE_VAULT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "vault"
);

const asset = (localDateTime, extra = {}) => ({
  id: "a1",
  localDateTime,
  city: "Bicheno",
  people: [],
  ...extra
});

let savedVault;

test.beforeEach(async () => {
  savedVault = process.env.VAULT_ENABLED;
  // vault.spec.js's last buildIndex points at a directory that does not exist,
  // and the index is module-level — so rebuild per test rather than once.
  await buildIndex(FIXTURE_VAULT);
  process.env.VAULT_ENABLED = "1";
});

test.afterEach(() => {
  if (savedVault === undefined) delete process.env.VAULT_ENABLED;
  else process.env.VAULT_ENABLED = savedVault;
});

test.describe("OFF ⇒ identity — the rollback paths", () => {
  /* Asserted as the SAME ARRAY, not merely a deep-equal one: an identity return
     is what proves no work happened, and it is what keeps the route's memoised
     assets — shared between requests — untouched. */
  test("untouched when the vault lane is off", () => {
    delete process.env.VAULT_ENABLED;
    const assets = [asset("2019-10-08T09:00:00.000Z")];
    expect(labelTrips(assets)).toBe(assets);
    expect(assets[0].trip).toBeUndefined();
  });

  test("untouched when no note in the vault carries a date", async () => {
    // The second rollback, and the one that matters on the day this ships: the
    // code goes live INERT and turns on when the vault repo is pushed, not when
    // the dashboard deploys.
    await buildIndex(path.join(FIXTURE_VAULT, "does-not-exist"));
    const assets = [asset("2019-10-08T09:00:00.000Z")];
    expect(labelTrips(assets)).toBe(assets);
  });

  test("an empty pool is returned as-is rather than mapped", () => {
    const empty = [];
    expect(labelTrips(empty)).toBe(empty);
    expect(labelTrips(null)).toEqual([]);
  });
});

test.describe("ON — the vault's dates under a photograph", () => {
  test("a photograph inside the span is named by the trip", () => {
    expect(labelTrips([asset("2019-10-08T09:00:00.000Z")])[0].trip).toBe("Tasmania 2019");
  });

  test("both edges of the span are inside it", () => {
    expect(labelTrips([asset("2019-10-04T23:59:00.000Z")])[0].trip).toBe("Tasmania 2019");
    expect(labelTrips([asset("2019-10-14T00:01:00.000Z")])[0].trip).toBe("Tasmania 2019");
  });

  test("a photograph outside every span gets no key at all", () => {
    for (const day of ["2019-10-03T09:00:00.000Z", "2019-10-15T09:00:00.000Z", "2021-10-08T09:00:00.000Z"]) {
      expect(labelTrips([asset(day)])[0].trip).toBeUndefined();
    }
  });

  /* ⚠ THE YEAR COMES FROM THE PHOTOGRAPH, not from the note, and the fixture's
     Queenstown trip (28 Dec 2019 – 4 Jan 2020) is why. The trip REPLACES the
     bare year in the ground's caption, so if the author wrote the year into the
     label by hand, ONE of these two photographs would be captioned with the
     wrong one — and nothing would ever say so. */
  test("one trip across New Year captions each photograph with its OWN year", () => {
    const out = labelTrips([
      asset("2019-12-30T09:00:00.000Z"),
      asset("2020-01-02T09:00:00.000Z")
    ]);
    expect(out[0].trip).toBe("Queenstown 2019");
    expect(out[1].trip).toBe("Queenstown 2020");
  });

  /* Local, never UTC. Thailand is UTC+7 and a 9am Bangkok photograph converted
     through toISOString() lands on the PREVIOUS day — which would drop every
     morning of a trip out of its own span, at both ends. A string slice cannot
     make that mistake, and this pins it. */
  test("the local day is what counts, not the UTC one", () => {
    // 2019-10-04T02:00+11:00 is 2019-10-03T15:00Z — the day before the trip
    // starts if anyone converts. localDateTime already IS the local day.
    expect(labelTrips([asset("2019-10-04T02:00:00.000+11:00")])[0].trip).toBe("Tasmania 2019");
  });

  test("a missing or malformed date is not on any trip", () => {
    for (const raw of [undefined, null, "", 20191008, "October 2019", {}]) {
      expect(labelTrips([asset(raw)])[0].trip).toBeUndefined();
    }
  });

  /* The route memo holds the RAW upstream assets and is shared between
     requests. A mutation here would pin a caption into a cache the ten-minute
     vault reindex can no longer reach — an edited note would look unsynced for
     an hour. */
  test("the input is never mutated", () => {
    const original = asset("2019-10-08T09:00:00.000Z");
    const out = labelTrips([original]);
    expect(original.trip).toBeUndefined();
    expect(out[0]).not.toBe(original);
    expect(out[0].id).toBe(original.id);
    expect(out[0].city).toBe(original.city);
  });

  test("everything else on the asset survives the labelling", () => {
    const rich = asset("2019-10-08T09:00:00.000Z", {
      people: ["our niece Melanie"],
      aspect: 1.5,
      width: 4032,
      height: 3024,
      motionId: "m1"
    });
    const out = labelTrips([rich])[0];
    expect(out).toMatchObject({
      people: ["our niece Melanie"],
      aspect: 1.5,
      width: 4032,
      height: 3024,
      motionId: "m1",
      trip: "Tasmania 2019"
    });
  });
});
