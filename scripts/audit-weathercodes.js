import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WEATHER_ANIMATIONS } from "../static/js/config/weather-animations.js";
import { weatherText } from "../static/js/services/weather/mapper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPEN_METEO_CODES = [
  0,
  1,
  2,
  3,
  45,
  48,
  51,
  53,
  55,
  56,
  57,
  61,
  63,
  65,
  66,
  67,
  71,
  73,
  75,
  77,
  80,
  81,
  82,
  85,
  86,
  95,
  96,
  99
];

const lottieDir = path.join(
  __dirname,
  "..",
  "static",
  "icons",
  "weather",
  "lottie"
);
const lottieFiles = new Set(fs.readdirSync(lottieDir));

const missingMappings = OPEN_METEO_CODES.filter(
  code => !Object.prototype.hasOwnProperty.call(WEATHER_ANIMATIONS, code)
);

const missingLotties = [];
for (const [code, variants] of Object.entries(WEATHER_ANIMATIONS)) {
  for (const [variant, file] of Object.entries(variants)) {
    if (!lottieFiles.has(file)) {
      missingLotties.push({ code: Number(code), variant, file });
    }
  }
}

const unhandledDescriptions = OPEN_METEO_CODES.filter(
  code => weatherText(code) === "Weather"
);

const report = {
  missingMappings,
  missingLotties,
  unhandledDescriptions
};

console.log(JSON.stringify(report, null, 2));
