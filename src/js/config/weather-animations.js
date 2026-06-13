// static/js/config/weather-animations.js

// Map Open-Meteo weather codes to Lottie filenames (day/night).
// We only store filenames; your loadLottieAnimation helper will
// handle the /static/icons/weather/lottie/ path.

export const WEATHER_ANIMATIONS = {
  // 0–3: Clear / partly cloudy / overcast
  0: { day: "clear-day.json", night: "clear-night.json" },
  1: { day: "partly-cloudy-day.json", night: "partly-cloudy-night.json" },
  2: { day: "partly-cloudy-day.json", night: "partly-cloudy-night.json" },
  3: { day: "overcast-day.json", night: "overcast-night.json" },

  // 45–48: Fog / mist
  45: { day: "fog-day.json", night: "fog-night.json" },
  48: { day: "fog-day.json", night: "fog-night.json" },

  // 51–57: Drizzle / freezing drizzle
  51: { day: "partly-cloudy-day-drizzle.json", night: "partly-cloudy-night-drizzle.json" },
  53: { day: "overcast-day-drizzle.json", night: "overcast-night-drizzle.json" },
  55: { day: "extreme-day-drizzle.json", night: "extreme-night-drizzle.json" },
  56: { day: "overcast-day-sleet.json", night: "overcast-night-sleet.json" }, // freezing drizzle
  57: { day: "extreme-day-sleet.json", night: "extreme-night-sleet.json" },

  // 61–67: Rain / freezing rain
  61: { day: "partly-cloudy-day-rain.json", night: "partly-cloudy-night-rain.json" },
  63: { day: "overcast-day-rain.json", night: "overcast-night-rain.json" },
  65: { day: "extreme-day-rain.json", night: "extreme-night-rain.json" },
  66: { day: "overcast-day-sleet.json", night: "overcast-night-sleet.json" }, // freezing rain
  67: { day: "extreme-day-sleet.json", night: "extreme-night-sleet.json" },

  // 71–77: Snow
  71: { day: "partly-cloudy-day-snow.json", night: "partly-cloudy-night-snow.json" },
  73: { day: "overcast-day-snow.json", night: "overcast-night-snow.json" },
  75: { day: "extreme-day-snow.json", night: "extreme-night-snow.json" },
  77: { day: "snow.json", night: "snow.json" }, // snow grains

  // 80–82: Rain showers
  80: { day: "partly-cloudy-day-rain.json", night: "partly-cloudy-night-rain.json" },
  81: { day: "overcast-day-rain.json", night: "overcast-night-rain.json" },
  82: { day: "extreme-day-rain.json", night: "extreme-night-rain.json" },

  // 85–86: Snow showers
  85: { day: "partly-cloudy-day-snow.json", night: "partly-cloudy-night-snow.json" },
  86: { day: "extreme-day-snow.json", night: "extreme-night-snow.json" },

  // 95–99: Thunderstorms
  95: { day: "thunderstorms-day.json", night: "thunderstorms-night.json" },
  96: {
    day: "thunderstorms-day-overcast-rain.json",
    night: "thunderstorms-night-overcast-rain.json"
  },
  99: {
    day: "thunderstorms-day-extreme-rain.json",
    night: "thunderstorms-night-extreme-rain.json"
  }
};

// Fallbacks if we get unmapped codes.
const FALLBACK_DAY = "clear-day.json";
const FALLBACK_NIGHT = "clear-night.json";

/**
 * Returns the best Lottie filename for a given weather code and time of day.
 * @param {number} code - Open-Meteo weathercode
 * @param {boolean} isDay - true if daytime, false if night
 * @returns {string} Lottie filename
 */
export function getWeatherAnimationFilename(code, isDay) {
  const entry = WEATHER_ANIMATIONS[code];
  const variant = isDay ? "day" : "night";

  if (entry && entry[variant]) {
    return entry[variant];
  }

  // If we only have one variant defined, use it as a fallback
  if (entry && entry.day && !entry.night) return entry.day;
  if (entry && entry.night && !entry.day) return entry.night;

  return isDay ? FALLBACK_DAY : FALLBACK_NIGHT;
}

/**
 * Convert wind speed in km/h to Beaufort scale (0–12).
 * @param {number} windKmh
 * @returns {number} beaufort number
 */
export function getBeaufortNumber(windKmh) {
  if (windKmh < 1) return 0;
  if (windKmh <= 5) return 1;
  if (windKmh <= 11) return 2;
  if (windKmh <= 19) return 3;
  if (windKmh <= 28) return 4;
  if (windKmh <= 38) return 5;
  if (windKmh <= 49) return 6;
  if (windKmh <= 61) return 7;
  if (windKmh <= 74) return 8;
  if (windKmh <= 88) return 9;
  if (windKmh <= 102) return 10;
  if (windKmh <= 117) return 11;
  return 12;
}

/**
 * Get Lottie filename for Beaufort wind icon.
 * @param {number} beaufortNumber - 0–12
 * @returns {string} Lottie filename
 */
export function getWindBeaufortFilename(beaufortNumber) {
  const clamped = Math.max(0, Math.min(12, Math.round(beaufortNumber)));
  return `wind-beaufort-${clamped}.json`;
}

/**
 * Rough compass direction from degrees (0–360).
 * @param {number} degrees
 * @returns {string} like "N", "NE", "E", etc.
 */
export function describeWindDirection(degrees) {
  if (degrees == null || isNaN(degrees)) return "";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round((degrees % 360) / 45) % 8;
  return dirs[idx];
}
