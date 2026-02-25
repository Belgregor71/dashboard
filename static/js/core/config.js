const ENV = typeof window !== "undefined" ? window.__ENV__ ?? {} : {};
const DASH_CONFIG = typeof window !== "undefined" ? window.__DASH_CONFIG__ ?? {} : {};
const HA_DASH_CONFIG = DASH_CONFIG.homeAssistant ?? {};

export const CONFIG = {
  homeAssistant: {
    enabled: true,
    url: "",
    debug: HA_DASH_CONFIG.debug === true || ENV.HA_DEBUG === "1",
    reconnectInterval: 5000,
    mediaPlayers: [
      { entityId: "media_player.living_room", label: "Living Room" },
      { entityId: "media_player.piano_room", label: "Piano Room" }
    ],
    doorbellOverlay: {
      enabled: true,
      triggerEntityId: "binary_sensor.doorbell_motion_detected",
      triggerEntityIds: [
        "binary_sensor.doorbell_motion_detected",
        "binary_sensor.front_doorbell_motion"
      ],
      triggerStates: ["on", "ringing"],
      cameraEntityId: "camera.doorbell",
      streamPath: "/api/camera_proxy/camera.doorbell",
      activeLabel: "Doorbell motion detected",
      autoCloseMs: 45000
    },
    cameraFeeds: [
      {
        entityId: "camera.kitchen",
        label: "Kitchen",
        streamPath: "/api/camera_proxy/camera.kitchen"
      },
      {
        entityId: "camera.piano_room",
        label: "Piano Room",
        streamPath: "/api/camera_proxy/camera.piano_room"
      },
      {
        entityId: "camera.tilt_pan",
        label: "Garage (Pan & Tilt)",
        streamPath: "/api/camera_proxy/camera.tilt_pan"
      },
      {
        entityId: "camera.doorbell",
        label: "Doorbell",
        streamPath: "/api/camera_proxy/camera.doorbell"
      },
      {
        entityId: "camera.front_yard",
        label: "Front Yard",
        streamPath: "/api/camera_proxy/camera.front_yard"
      },
      {
        entityId: "camera.driveway",
        label: "Driveway",
        streamPath: "/api/camera_proxy/camera.driveway"
      },
      {
        entityId: "camera.backyard",
        label: "Backyard",
        streamPath: "/api/camera_proxy/camera.backyard"
      },
      {
        entityId: "camera.patio",
        label: "Patio",
        streamPath: "/api/camera_proxy/camera.patio"
      },
      {
        entityId: "camera.side_gate",
        label: "Side Gate",
        streamPath: "/api/camera_proxy/camera.side_gate"
      }
    ],
    cameraMotionView: {
      enabled: true,
      view: "cameras",
      returnView: "home",
      durationMs: 30000,
      triggerStates: ["on", "ringing", "detected", "motion"],
      triggerEntityIds: [
        "binary_sensor.doorbell_motion_detected",
        "binary_sensor.front_doorbell_motion",
        "binary_sensor.front_yard_motion",
        "binary_sensor.driveway_motion",
        "binary_sensor.backyard_motion_detected",
        "binary_sensor.backyard_motion",
        "binary_sensor.patio_motion",
        "binary_sensor.side_gate_motion"
      ]
    },
    energySaver: {
      enabled: true,
      wakeTime: "05:00",
      sleepTime: "21:00",
      monitorEntityId: ""
    }
  },
  systemStatus: {
    modeLabel: "Normal",
    modeEntityId: ""
  }
};
