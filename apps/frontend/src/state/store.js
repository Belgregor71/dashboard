import { create } from 'zustand';

function setByPath(target, path, value) {
  const next = structuredClone(target);
  let ptr = next;
  for (let i = 0; i < path.length - 1; i += 1) ptr = ptr[path[i]] ||= {};
  ptr[path[path.length - 1]] = value;
  return next;
}

export const useDashboardStore = create((set) => ({
  state: { cameras: {}, weather: {}, system: {}, calendar: {} },
  handleEvent: (event) => {
    if (event.type === 'INIT_STATE') set({ state: event.payload });
    if (event.type === 'STATE_UPDATE') set((curr) => ({ state: setByPath(curr.state, event.payload.path, event.payload.value) }));
  }
}));
