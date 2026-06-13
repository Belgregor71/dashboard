// static/js/weatherBackgrounds.js
import { categoryForWeatherCode } from "./weatherPrompts.js";

const VARIANTS_PER_CATEGORY = 3; // set 3–5

function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function backgroundUrlForWeatherCode(code) {
  const category = categoryForWeatherCode(code);

  // deterministic rotation: same day -> same variant
  const variant = (dayOfYear() % VARIANTS_PER_CATEGORY) + 1;

  // cache-busting only when you bump the version
  const version = "v1";

  return `/assets/weather_bg/${category}_${version}_${variant}.webp`;
}
