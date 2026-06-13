const entities = {};

export function updateEntity(entity) {
  if (!entity?.entity_id) return;
  const existing = entities[entity.entity_id] ?? {};
  entities[entity.entity_id] = {
    ...existing,
    ...entity,
    attributes: {
      ...(existing.attributes ?? {}),
      ...(entity.attributes ?? {})
    }
  };
}

export function getEntity(entityId) {
  return entities[entityId];
}

export function getAllEntities() {
  return entities;
}
