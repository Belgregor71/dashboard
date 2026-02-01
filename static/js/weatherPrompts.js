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
