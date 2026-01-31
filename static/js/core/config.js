const ENV = typeof window !== "undefined" ? window.__ENV__ ?? {} : {};

export const CONFIG = {
  homeAssistant: {
    enabled: true,
    url: ENV.HA_HOST || "http://192.168.0.179:8123",
    token: ENV.HA_TOKEN || "",
    reconnectInterval: 5000,
    mediaPlayers: [
      { entityId: "media_player.living_room", label: "Living Room" },
      { entityId: "media_player.piano_room", label: "Piano Room" }
    ],
    doorbellOverlay: {
      enabled: true,
      triggerEntityId: "binary_sensor.front_doorbell_motion",
      triggerStates: ["on", "ringing"],
      cameraEntityId: "camera.doorbell",
      streamPath: "/api/camera_proxy_stream/camera.doorbell",
      activeLabel: "Doorbell motion detected",
      autoCloseMs: 45000
    },
    cameraFeeds: [
      {
        entityId: "camera.kitchen",
        label: "Kitchen",
        streamPath: "/api/camera_proxy_stream/camera.kitchen"
      },
      {
        entityId: "camera.piano_room",
        label: "Piano Room",
        streamPath: "/api/camera_proxy_stream/camera.piano_room"
      },
      {
        entityId: "camera.tilt_pan",
        label: "Garage (Pan & Tilt)",
        streamPath: "/api/camera_proxy_stream/camera.tilt_pan"
      },
      {
        entityId: "camera.doorbell",
        label: "Doorbell",
        streamPath: "/api/camera_proxy_stream/camera.doorbell"
      },
      {
        entityId: "camera.front_yard",
        label: "Front Yard",
        streamPath: "/api/camera_proxy_stream/camera.front_yard"
      },
      {
        entityId: "camera.driveway",
        label: "Driveway",
        streamPath: "/api/camera_proxy_stream/camera.driveway"
      },
      {
        entityId: "camera.backyard",
        label: "Backyard",
        streamPath: "/api/camera_proxy_stream/camera.backyard"
      },
      {
        entityId: "camera.patio",
        label: "Patio",
        streamPath: "/api/camera_proxy_stream/camera.patio"
      },
      {
        entityId: "camera.side_gate",
        label: "Side Gate",
        streamPath: "/api/camera_proxy_stream/camera.side_gate"
      }
    ],
    cameraMotionView: {
      enabled: true,
      view: "cameras",
      returnView: "home",
      durationMs: 30000,
      triggerStates: ["on", "ringing", "detected", "motion"],
      triggerEntityIds: [
        "binary_sensor.front_doorbell_motion",
        "binary_sensor.front_yard_motion",
        "binary_sensor.driveway_motion",
        "binary_sensor.backyard_motion",
        "binary_sensor.patio_motion",
        "binary_sensor.side_gate_motion"
      ]
    }
  }
};
