import { create } from 'zustand';

const CAMERA_STALE_TIMEOUT_MS = 30_000;

export const useDashboardStore = create((set, get) => ({
  latestCameraEvents: {},
  setLatestCameraEvent: (event) =>
    set((state) => {
      const previous = state.latestCameraEvents[event.cameraId];
      if (previous && Date.parse(previous.timestamp) >= Date.parse(event.timestamp)) return state;
      return {
        latestCameraEvents: {
          ...state.latestCameraEvents,
          [event.cameraId]: event
        }
      };
    }),
  clearStaleCameraImages: () => {
    const now = Date.now();
    const latest = get().latestCameraEvents;
    const next = Object.fromEntries(
      Object.entries(latest).filter(([, event]) => now - Date.parse(event.timestamp) <= CAMERA_STALE_TIMEOUT_MS)
    );
    set({ latestCameraEvents: next });
  }
}));
