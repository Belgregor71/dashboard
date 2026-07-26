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
