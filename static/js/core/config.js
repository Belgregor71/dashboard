export const CONFIG = {
  homeAssistant: {
    enabled: true,
    url: "http://192.168.0.179:8123",
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJlMDZkYWJiNGZhMGY0YThhOTlhZGU1MTkzZTg2YmFkZiIsImlhdCI6MTc2ODIwMTEwNiwiZXhwIjoyMDgzNTYxMTA2fQ.4jTFUKZYqaf90O_whd5I8v5MItBhIhLbUxOQhOhjWbI",
    reconnectInterval: 5000,
    mediaPlayers: [
      { entityId: "media_player.living_room", label: "Living Room" },
      { entityId: "media_player.piano_room", label: "Piano Room" }
    ]
  }
};
