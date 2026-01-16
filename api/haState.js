export const HA_STATE = {};

export function updateEntity(entity) {
  HA_STATE[entity.entity_id] = entity;
}

export function getEntity(id) {
  return HA_STATE[id];
}
