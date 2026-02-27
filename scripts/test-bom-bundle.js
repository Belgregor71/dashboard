import {
  getBomForecastBundle,
  getEntityAttr,
  getEntityState,
  parseNumberSafe,
  parseTimeSafe
} from "../static/js/services/weather/bom.js";

const mockedStates = {
  "sensor.bom_forecast_day_5": {
    state: "Fine",
    attributes: {
      temp_min: "18",
      temp_max: "29",
      uv_max_index: "9",
      uv_category: "Very High",
      rain_chance: "60",
      rain_amount_min: "2",
      rain_amount_max: "8",
      sunrise: "2026-01-01T04:57:00+10:00",
      sunset: "2026-01-01T18:42:00+10:00"
    }
  }
};

const bundle = getBomForecastBundle("Test", 5, mockedStates);

const checks = [
  ["state", getEntityState(mockedStates, "sensor.bom_forecast_day_5", "") === "Fine"],
  ["attr", getEntityAttr(mockedStates, "sensor.bom_forecast_day_5", "temp_max", null) === "29"],
  ["parseNumber", parseNumberSafe("13.5", 0) === 13.5],
  ["parseTime", Boolean(parseTimeSafe("2026-01-01T05:00:00+10:00", null))],
  ["bundle temp", bundle.tempMax === 29],
  ["bundle rain", bundle.rainRange === "2-8 mm"],
  ["bundle uv", bundle.uvCategory === "Very High"]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("BOM normalization checks failed", failed.map(([name]) => name));
  process.exit(1);
}

console.log("BOM normalization checks passed", checks.map(([name]) => name).join(", "));
