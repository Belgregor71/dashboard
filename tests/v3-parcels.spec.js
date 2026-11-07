import { test, expect } from "@playwright/test";
import { parcelKind, decideParcel, PARCEL_FRESH_MS } from "../src/v3/core/parcels.js";

/* The parcel decision, in plain node. Entity ids mirror the live shape
   (area + email + suffix) with an invented address. */

const ID = "sensor.piano_room_someone_example_com_mail_packages_delivering";
const NOW = new Date(2026, 10, 7, 12, 0, 0).getTime();
const fresh = (state, id = ID) => ({ entity_id: id, state: String(state), last_changed: new Date(NOW - 1000).toISOString() });
const stale = (state, id = ID) => ({ entity_id: id, state: String(state), last_changed: new Date(NOW - PARCEL_FRESH_MS - 1000).toISOString() });
const blank = () => ({ day: null, delivering: 0, delivered: 0 });

test("only the two totals are parcel sensors, not the per-carrier ones", () => {
  expect(parcelKind(ID)).toBe("delivering");
  expect(parcelKind("sensor.x_mail_packages_delivered")).toBe("delivered");
  expect(parcelKind("sensor.x_mail_auspost_delivering")).toBeNull();
  expect(parcelKind("sensor.x_mail_amazon_packages_delivering")).toBeNull();
  expect(parcelKind("sensor.x_mail_packages_in_transit")).toBeNull();
  expect(parcelKind("binary_sensor.x_mail_packages_delivering")).toBeNull();
});

test("a fresh rise is a moment, with the counts it rose between", () => {
  const seen = blank();
  expect(decideParcel(fresh(1), seen, NOW)).toEqual({ kind: "delivering", count: 1, previous: 0 });
  expect(decideParcel(fresh(2), seen, NOW)).toEqual({ kind: "delivering", count: 2, previous: 1 });
});

test("the boot snapshot seeds the baseline and says nothing", () => {
  const seen = blank();
  expect(decideParcel(stale(1), seen, NOW)).toBeNull();
  expect(seen.delivering).toBe(1);
  // ...so the same count arriving fresh afterwards is not news either.
  expect(decideParcel(fresh(1), seen, NOW)).toBeNull();
});

test("a dip and recovery inside the day is not a second parcel", () => {
  const seen = blank();
  expect(decideParcel(fresh(1), seen, NOW)).not.toBeNull();
  expect(decideParcel(fresh(0), seen, NOW)).toBeNull();
  expect(decideParcel(fresh(1), seen, NOW)).toBeNull();
});

test("a new day starts the count again", () => {
  const seen = blank();
  decideParcel(fresh(1), seen, NOW);
  const tomorrow = NOW + 24 * 3600_000;
  const next = { entity_id: ID, state: "1", last_changed: new Date(tomorrow - 1000).toISOString() };
  expect(decideParcel(next, seen, tomorrow)).toEqual({ kind: "delivering", count: 1, previous: 0 });
});

test("unknown and unavailable are not counts", () => {
  const seen = blank();
  expect(decideParcel(fresh("unknown"), seen, NOW)).toBeNull();
  expect(decideParcel(fresh("unavailable"), seen, NOW)).toBeNull();
  expect(seen.delivering).toBe(0);
});

test("delivering and delivered keep separate tallies", () => {
  const seen = blank();
  decideParcel(fresh(2), seen, NOW);
  expect(decideParcel(fresh(1, "sensor.x_mail_packages_delivered"), seen, NOW))
    .toEqual({ kind: "delivered", count: 1, previous: 0 });
});
