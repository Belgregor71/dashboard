import { test, expect } from "@playwright/test";
import { on, off, emit } from "../src/js/core/eventBus.js";
import { registerEntityFeed, entityFeedRegistered } from "../src/js/services/homeAssistant/entityFeed.js";
import { getEntity, getAllEntities, __resetEntities } from "../src/js/services/homeAssistant/state.js";

/* The feed's contract. Pure-node — no browser, no DOM — which is the whole
   point: this is the half of the old events.js that V3 can share. If this file
   ever needs a page, the module has regressed into the thing it was split out of.

   Two properties carry the weight:

   1. ORDER. The cache must be written BEFORE `ha:state-updated` fires. Twelve
      modules on the incumbent read the cache from inside that handler; if the
      split reversed the order they would all read the previous value, and
      nothing would throw — it would just be quietly one tick stale forever.

   2. ABSENT IS NOT EMPTY. A snapshot that did not arrive must leave the cache
      alone. This repo has produced several bugs from treating "the upstream is
      down" as "there is nothing there", and a feed that blanks the cache on a
      dropped frame would hand that lie to every reader at once. */

const realFetch = globalThis.fetch;
let teardown = null;

/* The todo lists are fetched over HTTP off the back of a snapshot. Workers are
   reused across spec files, so a stub left in place would follow this file into
   the next pure-node spec in the same process. */
test.beforeEach(() => {
  __resetEntities();
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => "", json: async () => null });
  teardown = registerEntityFeed();
});

test.afterEach(() => {
  teardown?.();
  __resetEntities();
  globalThis.fetch = realFetch;
});

const entity = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });

test("a snapshot fills the entity cache", () => {
  emit("ha:states", [
    entity("sensor.temp", "21.4"),
    entity("binary_sensor.kitchen_motion_detected", "on")
  ]);

  expect(Object.keys(getAllEntities())).toHaveLength(2);
  expect(getEntity("sensor.temp").state).toBe("21.4");
  expect(getEntity("binary_sensor.kitchen_motion_detected").state).toBe("on");
});

test("a state change updates the cache and merges attributes", () => {
  emit("ha:states", [entity("media_player.lounge_room", "idle", { friendly_name: "Lounge" })]);

  emit("ha:event:state_changed", {
    new_state: entity("media_player.lounge_room", "playing", { media_title: "Nightswimming" })
  });

  const merged = getEntity("media_player.lounge_room");
  expect(merged.state).toBe("playing");
  expect(merged.attributes.media_title).toBe("Nightswimming");
  // The merge is why this matters: state_changed payloads are not always
  // complete, and dropping friendly_name would silently rename the player.
  expect(merged.attributes.friendly_name).toBe("Lounge");
});

test("the cache is written before ha:state-updated fires", () => {
  // The invariant the incumbent's DOM bridge depends on. Neuter it by moving
  // the emit above updateEntity and this is the only test that fails.
  const seen = [];
  const handler = (detail) => seen.push(getEntity(detail?.entity_id)?.state ?? null);
  on("ha:state-updated", handler);

  emit("ha:states", [entity("sensor.temp", "21.4")]);
  emit("ha:event:state_changed", { new_state: entity("sensor.temp", "22.9") });

  off("ha:state-updated", handler);
  expect(seen).toEqual(["21.4", "22.9"]);
});

test("todo items land on the entity as both items and all_items", () => {
  emit("ha:states", [entity("todo.shopping_list", "2")]);
  emit("ha:todo-items", {
    entityId: "todo.shopping_list",
    items: [{ summary: "milk", status: "needs_action" }]
  });

  const list = getEntity("todo.shopping_list");
  // HA's todo integrations disagree about which key holds the items, so the
  // feed writes both — todoEntities.normalizeItems() reads either.
  expect(list.attributes.items).toHaveLength(1);
  expect(list.attributes.all_items).toHaveLength(1);
  expect(list.state).toBe("2");
});

/* The bus deliberately does NOT let a throwing handler die quietly: it logs and
   then re-throws on a fresh task, so the failure still lands as an uncaught page
   error, which is the only signal tests/ui.spec.js watches. That makes a throw in
   here invisible to a normal assertion — the test body finishes green and the
   error surfaces a tick later, somewhere else. So catch it deliberately. */
async function uncaughtDuring(fn) {
  const previous = process.listeners("uncaughtException");
  previous.forEach((l) => process.removeListener("uncaughtException", l));
  const caught = [];
  const capture = (error) => caught.push(error);
  process.on("uncaughtException", capture);

  fn();
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the re-throw land

  process.removeListener("uncaughtException", capture);
  previous.forEach((l) => process.on("uncaughtException", l));
  return caught;
}

test("a snapshot that did not arrive leaves the cache standing, and does not throw", async () => {
  emit("ha:states", [entity("sensor.temp", "21.4")]);

  // What a dropped or malformed frame looks like on the bus. None of these is
  // "the house has no entities" and none of them may be treated as such — and
  // `null.forEach` is an uncaught page error on a wall that runs for weeks.
  const caught = await uncaughtDuring(() => {
    emit("ha:states", null);
    emit("ha:states", undefined);
    emit("ha:states", { error: "upstream unavailable" });
  });

  expect(caught).toEqual([]);
  expect(getEntity("sensor.temp").state).toBe("21.4");
  expect(Object.keys(getAllEntities())).toHaveLength(1);
});

test("a state change with no entity is ignored rather than thrown on", async () => {
  emit("ha:states", [entity("sensor.temp", "21.4")]);

  const caught = await uncaughtDuring(() => {
    emit("ha:event:state_changed", {});
    emit("ha:event:state_changed", { new_state: null });
    emit("ha:event:state_changed", null);
  });

  expect(caught).toEqual([]);
  expect(Object.keys(getAllEntities())).toHaveLength(1);
});

test("teardown unsubscribes, and registering twice yields one subscription", () => {
  // A 24/7 surface cannot afford a feed that stacks handlers on re-init, and
  // the module is the only writer to a cache the whole house reads.
  const second = registerEntityFeed();
  expect(second).toBe(teardown);

  const seen = [];
  const handler = () => seen.push(1);
  on("ha:state-updated", handler);
  emit("ha:states", [entity("sensor.temp", "21.4")]);
  expect(seen).toHaveLength(1);

  teardown();
  teardown = null;
  expect(entityFeedRegistered()).toBe(false);

  emit("ha:states", [entity("sensor.other", "9")]);
  off("ha:state-updated", handler);

  expect(seen).toHaveLength(1);
  expect(getEntity("sensor.other")).toBeUndefined();
});
