export const CONFIG = {
  homeAssistant: {
    enabled: true,
    url: "http://homeassistant.local:8123",
    token: "YOUR_LONG_LIVED_TOKEN",
    reconnectInterval: 5000,
    mediaPlayers: [
      { entityId: "media_player.living_room", label: "Living Room" },
      { entityId: "media_player.piano_room", label: "Piano Room" }
    ]
  }
};
