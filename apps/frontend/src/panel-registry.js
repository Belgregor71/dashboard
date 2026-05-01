import { lazy } from 'preact/compat';

export const panelRegistry = {
  camera: lazy(() => import('./panels/camera-panel.jsx').then((m) => ({ default: m.CameraPanel }))),
  calendar: lazy(() => import('./panels/camera-panel.jsx').then((m) => ({ default: m.CameraPanel }))),
  media: lazy(() => import('./panels/camera-panel.jsx').then((m) => ({ default: m.CameraPanel }))),
  system: lazy(() => import('./panels/camera-panel.jsx').then((m) => ({ default: m.CameraPanel })))
};
