import { create } from 'zustand';

function applyDomainEvent(state, event) {
  switch (event.type) {
    case 'CAMERA_MOTION_DETECTED':
    case 'CAMERA_IMAGE_CAPTURED': {
      const { cameraId, ...rest } = event.payload;
      if (!cameraId) return state;
      return {
        ...state,
        cameras: {
          ...state.cameras,
          [cameraId]: {
            ...(state.cameras[cameraId] || {}),
            ...rest
          }
        }
      };
    }
    case 'CALENDAR_UPDATED':
      return { ...state, calendar: { ...state.calendar, ...event.payload } };
    case 'SYSTEM_HEALTH':
      return { ...state, system: { ...event.payload } };
    default:
      return state;
  }
}

export const useDashboardStore = create((set) => ({
  state: { cameras: {}, weather: {}, system: {}, calendar: {} },
  applySnapshot: (state) => set({ state }),
  applyEvent: (event) => set((curr) => ({ state: applyDomainEvent(curr.state, event) }))
}));
