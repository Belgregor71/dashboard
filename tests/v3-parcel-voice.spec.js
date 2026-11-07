import { test, expect } from "@playwright/test";

/* When a parcel moment earns a Kath and Kim remark, in plain node. The flag is
   read off window.CONFIG, so each test sets it. Times are local. */

let parcelVoiceEvent;
const NOON = new Date(2026, 10, 7, 12, 0);
const LATE = new Date(2026, 10, 7, 22, 30);
const EARLY = new Date(2026, 10, 7, 6, 30);
const on = { cast: true, gaming: false };

test.beforeAll(async () => {
  globalThis.window = { CONFIG: { features: {} } };
  ({ parcelVoiceEvent } = await import("../src/v3/core/parcel-voice.js"));
});
test.afterAll(() => { delete globalThis.window; });
test.beforeEach(() => { window.CONFIG.features = { v3ParcelVoice: true }; });

test("each kind has its own event", () => {
  expect(parcelVoiceEvent({ kind: "delivering" }, { now: NOON, ...on })).toBe("parcel:delivering");
  expect(parcelVoiceEvent({ kind: "delivered" }, { now: NOON, ...on })).toBe("parcel:delivered");
});

test("flag off says nothing", () => {
  window.CONFIG.features = { v3ParcelVoice: false };
  expect(parcelVoiceEvent({ kind: "delivered" }, { now: NOON, ...on })).toBeNull();
});

test("the cast off says nothing — there is no plain-voice fallback", () => {
  expect(parcelVoiceEvent({ kind: "delivered" }, { now: NOON, cast: false, gaming: false })).toBeNull();
});

test("quiet hours and a game running say nothing", () => {
  expect(parcelVoiceEvent({ kind: "delivered" }, { now: LATE, ...on })).toBeNull();
  expect(parcelVoiceEvent({ kind: "delivered" }, { now: EARLY, ...on })).toBeNull();
  expect(parcelVoiceEvent({ kind: "delivered" }, { now: NOON, cast: true, gaming: true })).toBeNull();
});

test("an unknown kind is not an event", () => {
  expect(parcelVoiceEvent({ kind: "lost" }, { now: NOON, ...on })).toBeNull();
  expect(parcelVoiceEvent(null, { now: NOON, ...on })).toBeNull();
});
