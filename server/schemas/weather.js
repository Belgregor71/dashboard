const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

export const weatherNowSchema = {
  type: "object",
  required: ["location", "now", "day"],
  properties: {
    location: {
      type: "object",
      required: ["name", "tz"],
      properties: {
        name: { type: "string" },
        tz: { type: "string" }
      },
      additionalProperties: false
    },
    now: {
      type: "object",
      required: ["temp_c", "feels_like_c", "condition", "wind_kph", "humidity_pct", "uv", "rain_chance_pct"],
      properties: {
        temp_c: nullableNumber,
        feels_like_c: nullableNumber,
        condition: {
          type: "object",
          required: ["code", "label", "icon"],
          properties: {
            code: nullableNumber,
            label: nullableString,
            icon: nullableString
          },
          additionalProperties: false
        },
        wind_kph: nullableNumber,
        humidity_pct: nullableNumber,
        uv: nullableNumber,
        rain_chance_pct: nullableNumber
      },
      additionalProperties: false
    },
    day: {
      type: "object",
      required: ["high_c", "low_c", "sunrise", "sunset"],
      properties: {
        high_c: nullableNumber,
        low_c: nullableNumber,
        sunrise: nullableString,
        sunset: nullableString
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

export const weatherForecastSchema = {
  type: "object",
  required: ["days"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        required: ["date", "high_c", "low_c", "condition", "rain_chance_pct"],
        properties: {
          date: { type: "string" },
          high_c: nullableNumber,
          low_c: nullableNumber,
          condition: {
            type: "object",
            required: ["code", "label", "icon"],
            properties: {
              code: nullableNumber,
              label: nullableString,
              icon: nullableString
            },
            additionalProperties: false
          },
          rain_chance_pct: nullableNumber
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
};
