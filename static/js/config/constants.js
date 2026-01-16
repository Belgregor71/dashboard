// Coordinates for Brisbane
export const WEATHER_LAT = -27.4698;
export const WEATHER_LON = 153.0251;

export const REFRESH_CALENDAR_MS = 5 * 60 * 1000;
export const REFRESH_WEATHER_MS = 15 * 60 * 1000;
export const REFRESH_CLOCK_MS = 1000;
export const BACKGROUND_INTERVAL = 5 * 60 * 1000;

export const MEAL_PREFIX = "MEAL:";

export const CALENDAR_SOURCES = [
  { id: "google", name: "Family", icsUrl: "/api/calendar/google", color: "#F5A623" },
  { id: "apple", name: "Home Calendar", icsUrl: "/api/calendar/apple", color: "#FF9500" },
  { id: "tripit", name: "Travel", icsUrl: "/api/calendar/tripit", color: "#50E3C2" }
];

export const EVENT_ICONS = {
  gym: "🏋️",
  flight: "✈️",
  airport: "🛫",
  doctor: "🩺",
  dentist: "🦷",
  meeting: "📅",
  birthday: "🎂",
  anniversary: "💍",
  school: "🏫",
  haircut: "💈",
  concert: "🎵",
  movie: "🎬",
  meal: "🍽️",
  travel: "🧳"
};

export const COMMUTE_ORIGIN = "46 O'Doherty Cct, Nudgee QLD 4014";
export const COMMUTE_GREG_DEST = "935 Kingsford Smith Dr, Eagle Farm QLD 4009";
export const COMMUTE_BRETT_DEST = "71 Charles Ulm Dr, Eagle Farm QLD 4009";

export const WEATHER_ANIMATIONS = {
  0: { day: "clear-day.json", night: "clear-night.json" },
  1: { day: "clear-day.json", night: "clear-night.json" },
  2: { day: "partly-cloudy-day.json", night: "partly-cloudy-night.json" },
  3: { day: "overcast-day.json", night: "overcast-night.json" },
  45: { day: "fog-day.json", night: "fog-night.json" },
  48: { day: "fog-day.json", night: "fog-night.json" },
  51: { day: "drizzle-day.json", night: "drizzle-night.json" },
  53: { day: "drizzle-day.json", night: "drizzle-night.json" },
  55: { day: "drizzle-day.json", night: "drizzle-night.json" },
  56: { day: "drizzle-day.json", night: "drizzle-night.json" },
  57: { day: "drizzle-day.json", night: "drizzle-night.json" },
  61: { day: "rain-day.json", night: "rain-night.json" },
  63: { day: "rain-day.json", night: "rain-night.json" },
  65: { day: "rain-day.json", night: "rain-night.json" },
  66: { day: "rain-day.json", night: "rain-night.json" },
  67: { day: "rain-day.json", night: "rain-night.json" },
  71: { day: "snow-day.json", night: "snow-night.json" },
  73: { day: "snow-day.json", night: "snow-night.json" },
  75: { day: "snow-day.json", night: "snow-night.json" },
  77: { day: "snow-day.json", night: "snow-night.json" },
  80: { day: "rain-day.json", night: "rain-night.json" },
  81: { day: "rain-day.json", night: "rain-night.json" },
  82: { day: "rain-day.json", night: "rain-night.json" },
  85: { day: "snow-day.json", night: "snow-night.json" },
  86: { day: "snow-day.json", night: "snow-night.json" },
  95: { day: "thunderstorms-day.json", night: "thunderstorms-night.json" },
  96: { day: "thunderstorms-day.json", night: "thunderstorms-night.json" },
  97: { day: "thunderstorms-day.json", night: "thunderstorms-night.json" }
};
