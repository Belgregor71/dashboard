export const CONFIG = {
  homeAssistant: {
    enabled: true,
    url: "http://192.168.0.179:8123",
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJlMDZkYWJiNGZhMGY0YThhOTlhZGU1MTkzZTg2YmFkZiIsImlhdCI6MTc2ODIwMTEwNiwiZXhwIjoyMDgzNTYxMTA2fQ.4jTFUKZYqaf90O_whd5I8v5MItBhIhLbUxOQhOhjWbI",
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
