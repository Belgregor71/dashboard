export const HA_STATE = {};

export function updateEntity(entity) {
  if (!entity?.entity_id) return;
  const existing = HA_STATE[entity.entity_id] ?? {};
  HA_STATE[entity.entity_id] = {
    ...existing,
    ...entity,
    attributes: {
      ...(existing.attributes ?? {}),
      ...(entity.attributes ?? {})
    }
  };
}

export function getEntity(id) {
  return HA_STATE[id];
}
