const ENV = typeof window !== "undefined" ? window.__ENV__ ?? {} : {};
const DASH_CONFIG = typeof window !== "undefined" ? window.__DASH_CONFIG__ ?? {} : {};
const HA_DASH_CONFIG = DASH_CONFIG.homeAssistant ?? {};
const DASH_WEATHER = DASH_CONFIG.weather ?? {};

const DEFAULT_BOM_DAILY = {
  5: { sourceEntityId: "" },
  6: { sourceEntityId: "" },
  7: { sourceEntityId: "" }
};

const DASH_BOM = DASH_WEATHER.bom ?? {};
const DASH_BOM_DAILY = DASH_BOM.daily ?? {};
const BOM_DAILY = {
  5: { ...DEFAULT_BOM_DAILY[5], ...(DASH_BOM_DAILY[5] ?? DASH_BOM_DAILY["5"] ?? {}) },
  6: { ...DEFAULT_BOM_DAILY[6], ...(DASH_BOM_DAILY[6] ?? DASH_BOM_DAILY["6"] ?? {}) },
  7: { ...DEFAULT_BOM_DAILY[7], ...(DASH_BOM_DAILY[7] ?? DASH_BOM_DAILY["7"] ?? {}) }
};

export const CONFIG = {
  weather: {
    debugBom: ENV.WEATHER_DEBUG_BOM === "1",
    bom: {
      locationName: "",
      warningsEntityId: "",
      hourlyEntityId: "",
      daily: DEFAULT_BOM_DAILY,
      ...DASH_BOM,
      daily: BOM_DAILY
    }
  },
  homeAssistant: {
    enabled: true,
    url: "",
    debug: HA_DASH_CONFIG.debug === true || ENV.HA_DEBUG === "1",
    reconnectInterval: 5000,
    mediaPlayers: [
      {
        entityIds: ["media_player.lounge_room", "media_player.living_room"],
        label: "Lounge Room"
      },
      {
        entityIds: ["media_player.piano_room", "media_player.piano"],
        label: "Piano Room"
      }
    ],
    doorbellOverlay: {
      enabled: false,
      triggerEntityId: "binary_sensor.front_door_motion_detected",
      triggerEntityIds: [
        "binary_sensor.front_door_motion_detected",
        "binary_sensor.front_door_ringing"
      ],
      triggerStates: ["on", "ringing"],
      cameraEntityId: "camera.front_door",
      streamPath: "/api/camera_proxy/camera.front_door",
      activeLabel: "Doorbell motion detected",
      autoCloseMs: 45000
    },
    cameraPopupOverlay: {
      enabled: true,
      triggerStates: ["on", "ringing", "detected", "motion"],
      debug: false,
      triggerCameraMap: [
        {
          entityId: "binary_sensor.front_door_motion_detected",
          camera: "front_door",
          title: "Front Door",
          detection: "Motion",
          priority: 100,
          duration: 45
        },
        {
          entityId: "binary_sensor.front_door_person_detected",
          camera: "front_door",
          title: "Front Door",
          detection: "Person",
          priority: 100,
          duration: 45
        },
        {
          entityId: "binary_sensor.front_door_ringing",
          camera: "front_door",
          title: "Front Door",
          detection: "Doorbell",
          priority: 100,
          duration: 45
        },
        {
          entityId: "image.front_door_event_image",
          camera: "front_door",
          title: "Front Door",
          detection: "Event image",
          priority: 100,
          duration: 45
        },
        {
          entityId: "binary_sensor.front_yard_motion_detected",
          camera: "front_yard",
          title: "Front Yard",
          detection: "Motion",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.front_yard_person_detected",
          camera: "front_yard",
          title: "Front Yard",
          detection: "Person",
          priority: 20,
          duration: 30
        },
        {
          entityId: "image.front_yard_event_image",
          camera: "front_yard",
          title: "Front Yard",
          detection: "Event image",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.driveway_motion_detected",
          camera: "driveway",
          title: "Driveway",
          detection: "Motion",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.driveway_person_detected",
          camera: "driveway",
          title: "Driveway",
          detection: "Person",
          priority: 20,
          duration: 30
        },
        {
          entityId: "image.driveway_event_image",
          camera: "driveway",
          title: "Driveway",
          detection: "Event image",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.backyard_motion_detected",
          camera: "backyard",
          title: "Backyard",
          detection: "Motion",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.backyard_person_detected",
          camera: "backyard",
          title: "Backyard",
          detection: "Person",
          priority: 20,
          duration: 30
        },
        {
          entityId: "image.backyard_event_image",
          camera: "backyard",
          title: "Backyard",
          detection: "Event image",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.patio_motion_detected",
          camera: "patio",
          title: "Patio",
          detection: "Motion",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.patio_person_detected",
          camera: "patio",
          title: "Patio",
          detection: "Person",
          priority: 20,
          duration: 30
        },
        {
          entityId: "image.patio_event_image",
          camera: "patio",
          title: "Patio",
          detection: "Event image",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.side_gate_motion_detected",
          camera: "side_gate",
          title: "Side Gate",
          detection: "Motion",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.side_gate_person_detected",
          camera: "side_gate",
          title: "Side Gate",
          detection: "Person",
          priority: 20,
          duration: 30
        },
        {
          entityId: "image.side_gate_event_image",
          camera: "side_gate",
          title: "Side Gate",
          detection: "Event image",
          priority: 20,
          duration: 30
        }
      ]
    },
    cameraFeeds: [
      {
        entityId: "camera.front_door",
        label: "Front Door",
        streamPath: "/api/camera_proxy/camera.front_door"
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
      enabled: false,
      view: "cameras",
      returnView: "home",
      durationMs: 30000,
      triggerStates: ["on", "ringing", "detected", "motion"],
      triggerEntityIds: [
        "binary_sensor.front_door_motion_detected",
        "binary_sensor.front_door_ringing",
        "binary_sensor.front_yard_motion_detected",
        "binary_sensor.driveway_motion_detected",
        "binary_sensor.backyard_motion_detected",
        "binary_sensor.patio_motion_detected",
        "binary_sensor.side_gate_motion_detected"
      ]
    },
    energySaver: {
      enabled: true,
      wakeTime: "05:00",
      sleepTime: "21:00",
      monitorEntityId: ""
    },
    mediaAutomation: {
      activeRefreshMs: 3000,
      idleRefreshMs: 20000,
      homeCooldownMs: 90000,
      diskWarnPct: 15,
      diskErrorPct: 8,
      entities: {},
      urls: {
        qbittorrent: "",
        sonarr: "",
        radarr: ""
      }
    }
  },
  systemStatus: {
    modeLabel: "Normal",
    modeEntityId: ""
  },
  occasions: {
    // Family birthdays — popup appears once on the morning of the birthday
    birthdays: [
      // { name: "Alice", month: 3, day: 15 },
      // { name: "Bob",   month: 8, day: 22 },
    ],
    // School holiday start dates — popup appears on the first day of each break
    schoolHolidays: [
      // { date: "2026-04-11", label: "Autumn School Holidays" },
      // { date: "2026-07-04", label: "Winter School Holidays" },
      // { date: "2026-09-19", label: "Spring School Holidays" },
      // { date: "2026-12-19", label: "Summer School Holidays" },
    ]
  }
};
