const entities = {};

// Bumps only when an entity_id is seen for the first time. Derived lookups that
// scan every entity (getTodoEntityIds, getBomRelatedEntityIds) memoize on this
// so they cost O(1) during a snapshot fan-out, which is ~700 entities deep.
let entitiesVersion = 0;

export function updateEntity(entity) {
  if (!entity?.entity_id) return;
  const existing = entities[entity.entity_id];
  if (!existing) entitiesVersion += 1;
  entities[entity.entity_id] = {
    ...(existing ?? {}),
    ...entity,
    attributes: {
      ...(existing?.attributes ?? {}),
      ...(entity.attributes ?? {})
    }
  };
}

export function getEntitiesVersion() {
  return entitiesVersion;
}

export function getEntity(entityId) {
  return entities[entityId];
}

export function getAllEntities() {
  return entities;
}

/* Test seam. This cache is module-level state with no other way back to empty,
   so a spec that seeded it leaked entities into every later spec in the same
   worker — houseSnapshot's specs inject their entities instead precisely to
   avoid that. The feed cannot: filling this cache is the thing it does.
   The version is BUMPED rather than zeroed, because the derived lookups
   memoize on it and a version that goes backwards hands them a stale answer. */
export function __resetEntities() {
  for (const key of Object.keys(entities)) delete entities[key];
  entitiesVersion += 1;
}
