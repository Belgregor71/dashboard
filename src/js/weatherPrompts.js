// static/js/weatherPrompts.js
// Map Open-Meteo weather codes into background/motion categories.

export function categoryForWeatherCode(code) {
  if (code == null) return "clear";

  const numericCode = Number(code);

  if (numericCode === 0) return "clear";
  if (numericCode === 1 || numericCode === 2) return "mostly_clear";
  if (numericCode === 3) return "cloudy";

  if (numericCode === 45 || numericCode === 48) return "fog";

  if (numericCode >= 51 && numericCode <= 57) return "drizzle";

  if (numericCode >= 61 && numericCode <= 67) return "rain";

  if (numericCode >= 71 && numericCode <= 77) return "snow";

  if (numericCode >= 80 && numericCode <= 82) return "showers";

  if (numericCode === 85 || numericCode === 86) return "snow";

  if (numericCode >= 95 && numericCode <= 99) return "storms";

  return "cloudy";
}

// Precip intensity tier for the living-window effects (atmoFx planner reads it
// off the contextStore weather slice). Pure over the WMO code, like
// categoryForWeatherCode above: last digit within each precip family encodes
// light→heavy. Non-precip codes return null.
export function intensityForWeatherCode(code) {
  if (code == null) return null;
  const n = Number(code);

  if (n === 51 || n === 56 || n === 61 || n === 66 || n === 71 || n === 77 || n === 80 || n === 85) return "light";
  if (n === 53 || n === 63 || n === 73 || n === 81 || n === 95) return "moderate";
  if (n === 55 || n === 57 || n === 65 || n === 67 || n === 75 || n === 82 || n === 86 || n === 96 || n === 99) return "heavy";

  return null;
}

// True for the WMO thunderstorm codes — marks the lightning lane.
export function isThunderCode(code) {
  const n = Number(code);
  return n === 95 || n === 96 || n === 99;
}
