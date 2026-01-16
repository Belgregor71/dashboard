const entities = {};

export function updateEntity(entity) {
  if (!entity?.entity_id) return;
  entities[entity.entity_id] = entity;
}

export function getEntity(entityId) {
  return entities[entityId];
}

export function getAllEntities() {
  return entities;
}
