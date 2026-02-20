export const aiRouteBodySchema = {
  type: "object",
  required: ["input"],
  properties: {
    input: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", minLength: 1, maxLength: 500 }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

export const aiBriefBodySchema = {
  type: "object",
  required: ["input"],
  properties: {
    input: {
      type: "object",
      properties: {
        context: {
          type: "object",
          default: {}
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

export const aiRouteResultSchema = {
  type: "object",
  required: ["intent", "confidence", "response"],
  properties: {
    intent: {
      type: "string",
      enum: ["switch_view", "show_weather", "show_cameras", "show_calendar", "status_explain", "unknown"]
    },
    view: {
      type: "string",
      enum: ["home", "weather", "cameras", "calendar", "agenda", "status", "briefing"]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    response: { type: "string", minLength: 1, maxLength: 200 }
  },
  additionalProperties: false
};
