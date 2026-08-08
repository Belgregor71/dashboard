/* ═══════════════════════════════════════════════════════════════════════════
   HA ENTITY FEED — the DOM-free half of what events.js used to do.

   WHY THIS EXISTS. `houseSnapshot()` and `voiceSnapshot()` are both pure reads
   against the in-memory entity cache in `./state.js`. Nothing in either module
   fills that cache — the only thing that ever called `updateEntity()` was
   `events.js`, and `events.js` imports `core/viewManager.js` and dispatches on
   `document`. So the cache was reachable only from a surface that has the
   incumbent's whole DOM behind it.

   V3 therefore booted with an entity cache that was permanently empty, and both
   snapshots correctly reported "I don't know" about everything, forever. That
   reads on the wall as broken and is not: absent is not empty, and the readers
   were right. The missing piece was the feed.

   WHAT MOVED. The three handlers that turn stream events into cache writes, and
   nothing else. `events.js` keeps every DOM-shaped thing it did — the command
   router, the view switches, and the `document` re-dispatch of
   `ha:state-updated`, which it now does by subscribing to the bus event emitted
   here. Ordering is unchanged: `emit()` is synchronous, so each entity is still
   written to the cache immediately before its own DOM event fires, which is the
   invariant every consumer of that event already relies on.

   The client (`./client.js`) needed no change at all — it was already DOM-free
   and already talking to the bus. The migration plan expected a
   `document.dispatchEvent` in it; there isn't one. The coupling was one layer up.
   ═══════════════════════════════════════════════════════════════════════════ */

import { emit, on } from "../../core/eventBus.js";
import { CONFIG } from "../../core/config.js";
import { getEntity, updateEntity } from "./state.js";
import { getTodoEntityIds } from "./todoEntities.js";
import { requestShoppingList, requestTodoItems } from "./client.js";

const SHOPPING_LIST_ENTITY_ID = CONFIG.homeAssistant?.shoppingListEntityId ?? "todo.shopping_list";

/* Todo lists do not arrive on the stream. HA's todo entities carry their items
   only in a service response, so a snapshot or a state change is the trigger to
   go and fetch them over HTTP — the same two-step the incumbent has always done,
   moved here because the list is house state, not a panel's private business. */
function refreshTodoLists() {
  getTodoEntityIds().forEach((entityId) => requestTodoItems(entityId));
  requestShoppingList();
}

function onTodoItems({ entityId, items }) {
  if (!entityId || !Array.isArray(items)) return;

  const current = getEntity(entityId);
  updateEntity({
    ...(current ?? {}),
    entity_id: entityId,
    attributes: {
      ...(current?.attributes ?? {}),
      items,
      all_items: items
    }
  });

  emit("ha:state-updated", { entity_id: entityId });
}

function onSnapshot(entities) {
  // Not an array means the snapshot did not arrive, which is not the same as a
  // house with no entities in it. Leaving the cache alone keeps the last known
  // good state standing rather than blanking every reader at once.
  if (!Array.isArray(entities)) return;

  entities.forEach((entity) => {
    updateEntity(entity);
    emit("ha:state-updated", entity);
  });

  refreshTodoLists();
}

function onStateChanged(data) {
  updateEntity(data?.new_state);
  emit("ha:state-updated", data?.new_state);

  const entityId = data?.new_state?.entity_id;
  if (getTodoEntityIds().includes(entityId)) requestTodoItems(entityId);
  if (entityId === SHOPPING_LIST_ENTITY_ID) requestShoppingList();
}

let teardown = null;

/**
 * Subscribe the entity cache to the HA stream. Call once per surface, before
 * `connectHA()`, so the first snapshot is not dropped.
 *
 * Returns a teardown. Nothing calls it in either surface today — both register
 * once at boot — but a feed with no way off is exactly the shape that produced
 * this repo's zombie listeners, and a spec cannot isolate itself without one.
 */
export function registerEntityFeed() {
  if (teardown) return teardown;

  const offs = [
    on("ha:todo-items", onTodoItems),
    on("ha:states", onSnapshot),
    on("ha:event:state_changed", onStateChanged)
  ];

  teardown = () => {
    offs.forEach((off) => off());
    teardown = null;
  };

  return teardown;
}

/** True once the feed is subscribed. Exposed for the surfaces' debug hooks. */
export function entityFeedRegistered() {
  return teardown !== null;
}
