// eufySerial: eufy device serial — go2rtc stream name used by /api/camera/:id/live
// (the eufy_security HA integration publishes P2P livestreams to go2rtc under the serial).
export const CAMERA_CONFIG = [
  {
    id: "doorbell",
    name: "Front Door",
    entity: "camera.doorbell",
    cameraEntity: "camera.doorbell",
    mode: "snapshot",
    eventImageEntity: "image.doorbell_event_image",
    preferredSnapshot: "eventImage",
    snapshotRefreshMs: 15000,
    pinnedHero: true,
    eufySerial: "T8210P3421280A30"
  },
  {
    id: "front_yard",
    name: "Front Yard",
    entity: "camera.front_yard",
    cameraEntity: "camera.front_yard",
    mode: "snapshot",
    eventImageEntity: "image.front_yard_event_image",
    preferredSnapshot: "eventImage",
    snapshotRefreshMs: 15000,
    eufySerial: "T8142N6321324822"
  },
  {
    id: "driveway",
    name: "Driveway",
    entity: "camera.driveway",
    cameraEntity: "camera.driveway",
    mode: "snapshot",
    eventImageEntity: "image.driveway_event_image",
    preferredSnapshot: "eventImage",
    snapshotRefreshMs: 15000,
    eufySerial: "T8124P3122443D52"
  },
  {
    id: "backyard",
    name: "Backyard",
    entity: "camera.backyard",
    cameraEntity: "camera.backyard",
    mode: "snapshot",
    eventImageEntity: "image.backyard_event_image",
    preferredSnapshot: "eventImage",
    snapshotRefreshMs: 15000,
    eufySerial: "T8142N63213238D1"
  },
  {
    id: "patio",
    name: "Patio",
    entity: "camera.patio",
    cameraEntity: "camera.patio",
    mode: "snapshot",
    eventImageEntity: "image.patio_event_image",
    preferredSnapshot: "eventImage",
    snapshotRefreshMs: 15000,
    eufySerial: "T8142N6321322FB5"
  },
  {
    id: "side_gate",
    name: "Side Gate",
    entity: "camera.side_gate",
    cameraEntity: "camera.side_gate",
    mode: "snapshot",
    eventImageEntity: "image.side_gate_event_image",
    preferredSnapshot: "eventImage",
    snapshotRefreshMs: 15000,
    eufySerial: "T8142N63213234A5"
  },
  {
    id: "tilt_pan",
    name: "Tilt Pan",
    entity: "camera.tilt_pan",
    cameraEntity: "camera.tilt_pan",
    mode: "snapshot",
    eventImageEntity: "image.tilt_pan_event_image",
    preferredSnapshot: "eventImage",
    snapshotRefreshMs: 15000,
    eufySerial: "T8410P31214323A2"
  }
];
