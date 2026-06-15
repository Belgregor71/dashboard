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
    // Optional Home Assistant BOM mapping.
    // Set sourceEntityId per day (5/6/7 supported), warningsEntityId, and hourlyEntityId to enable richer panels.
    // Env example:
    // WEATHER_DEBUG_BOM=1
    // BOM_LOCATION_NAME=Nudgee
    // BOM_WARNINGS_ENTITY_ID=sensor.nudgee_warnings
    // BOM_HOURLY_ENTITY_ID=weather.nudgee_hourly
    // BOM_RAIN_CHANCE_5=sensor.nudgee_rain_chance_5
    // BOM_RAIN_RANGE_5=sensor.nudgee_rain_amount_range_5
    // BOM_UV_CATEGORY_5=sensor.nudgee_uv_category_5
    // BOM_UV_MAX_5=sensor.nudgee_uv_max_index_5
    // BOM_RAIN_CHANCE_6=sensor.nudgee_rain_chance_6
    // BOM_RAIN_RANGE_6=sensor.nudgee_rain_amount_range_6
    // BOM_UV_CATEGORY_6=sensor.nudgee_uv_category_6
    // BOM_UV_MAX_6=sensor.nudgee_uv_max_index_6
    // BOM_RAIN_CHANCE_7=sensor.nudgee_rain_chance_7
    // BOM_RAIN_RANGE_7=sensor.nudgee_rain_amount_range_7
    // BOM_UV_CATEGORY_7=sensor.nudgee_uv_category_7
    // BOM_UV_MAX_7=sensor.nudgee_uv_max_index_7
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
    cameraPopupOverlay: {
      enabled: true,
      triggerStates: ["on", "ringing", "detected", "motion"],
      debug: false,
      triggerCameraMap: [
        {
          entityId: "binary_sensor.doorbell_motion_detected",
          camera: "doorbell",
          title: "Doorbell",
          detection: "Doorbell motion",
          priority: 100,
          duration: 45
        },
        {
          entityId: "binary_sensor.front_doorbell_motion",
          camera: "doorbell",
          title: "Doorbell",
          detection: "Doorbell motion",
          priority: 100,
          duration: 45
        },
        {
          entityId: "binary_sensor.doorbell_motion",
          camera: "doorbell",
          title: "Doorbell",
          detection: "Doorbell motion",
          priority: 100,
          duration: 45
        },
        {
          entityId: "binary_sensor.doorbell_ringing",
          camera: "doorbell",
          title: "Doorbell",
          detection: "Doorbell",
          priority: 100,
          duration: 45
        },
        {
          entityId: "image.doorbell_event_image",
          camera: "doorbell",
          title: "Doorbell",
          detection: "Event image",
          priority: 100,
          duration: 45
        },
        {
          entityId: "binary_sensor.front_yard_motion",
          camera: "front_yard",
          title: "Front Yard",
          detection: "Motion",
          priority: 20,
          duration: 30
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
          entityId: "image.front_yard_event_image",
          camera: "front_yard",
          title: "Front Yard",
          detection: "Event image",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.driveway_motion",
          camera: "driveway",
          title: "Driveway",
          detection: "Motion",
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
          entityId: "binary_sensor.backyard_motion",
          camera: "backyard",
          title: "Backyard",
          detection: "Motion",
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
          entityId: "binary_sensor.patio_motion",
          camera: "patio",
          title: "Patio",
          detection: "Motion",
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
          entityId: "image.patio_event_image",
          camera: "patio",
          title: "Patio",
          detection: "Event image",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.side_gate_motion",
          camera: "side_gate",
          title: "Side Gate",
          detection: "Motion",
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
          entityId: "image.side_gate_event_image",
          camera: "side_gate",
          title: "Side Gate",
          detection: "Event image",
          priority: 20,
          duration: 30
        },
        {
          entityId: "binary_sensor.kitchen_motion_detected",
          camera: "kitchen",
          title: "Kitchen",
          detection: "Motion",
          priority: 10,
          duration: 30
        },
        {
          entityId: "binary_sensor.kitchen_motion",
          camera: "kitchen",
          title: "Kitchen",
          detection: "Motion",
          priority: 10,
          duration: 30
        },
        {
          entityId: "image.kitchen_event_image",
          camera: "kitchen",
          title: "Kitchen",
          detection: "Event image",
          priority: 10,
          duration: 30
        },
        {
          entityId: "binary_sensor.piano_room_motion_detected",
          camera: "piano_room",
          title: "Piano Room",
          detection: "Motion",
          priority: 10,
          duration: 30
        },
        {
          entityId: "binary_sensor.piano_room_motion",
          camera: "piano_room",
          title: "Piano Room",
          detection: "Motion",
          priority: 10,
          duration: 30
        },
        {
          entityId: "image.piano_room_event_image",
          camera: "piano_room",
          title: "Piano Room",
          detection: "Event image",
          priority: 10,
          duration: 30
        },
        {
          entityId: "binary_sensor.tilt_pan_motion_detected",
          camera: "tilt_pan",
          title: "Garage (Pan & Tilt)",
          detection: "Motion",
          priority: 10,
          duration: 30
        },
        {
          entityId: "binary_sensor.tilt_pan_motion",
          camera: "tilt_pan",
          title: "Garage (Pan & Tilt)",
          detection: "Motion",
          priority: 10,
          duration: 30
        },
        {
          entityId: "image.tilt_pan_event_image",
          camera: "tilt_pan",
          title: "Garage (Pan & Tilt)",
          detection: "Event image",
          priority: 10,
          duration: 30
        }
      ]
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
      enabled: false,
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
    birthdays: [
      // { name: "Alice", month: 3, day: 15 },
      // { name: "Bob",   month: 8, day: 22 },
    ],
    schoolHolidays: [
      // { date: "2026-04-11", label: "Autumn School Holidays" },
      // { date: "2026-07-04", label: "Winter School Holidays" },
      // { date: "2026-09-19", label: "Spring School Holidays" },
      // { date: "2026-12-19", label: "Summer School Holidays" },
    ]
  }
};
