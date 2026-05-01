import { create } from 'zustand';

export const useDashboardStore = create((set) => ({
  latestCameraEvents: {},
  setLatestCameraEvent: (event) =>
    set((state) => {
      const previous = state.latestCameraEvents[event.cameraId];
      if (previous && previous.timestamp > event.timestamp) return state;
      return {
        latestCameraEvents: {
          ...state.latestCameraEvents,
          [event.cameraId]: event
        }
      };
    })
}));
