const statusItem = {
  type: "object",
  required: ["id", "label", "state", "detail"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    state: { type: "string", enum: ["ok", "warning", "down"] },
    detail: { type: "string" }
  },
  additionalProperties: false
};

export const haSnapshotSchema = {
  type: "object",
  required: ["home_mode", "alerts", "connectivity", "devices"],
  properties: {
    home_mode: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          required: ["id", "label"],
          properties: {
            id: { type: "string" },
            label: { type: "string" }
          },
          additionalProperties: false
        }
      ]
    },
    alerts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "severity", "title", "age_s"],
        properties: {
          id: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          title: { type: "string" },
          age_s: { type: "number", minimum: 0 }
        },
        additionalProperties: false
      }
    },
    connectivity: {
      anyOf: [{ type: "null" }, { type: "array", items: statusItem }],
      default: []
    },
    devices: {
      anyOf: [{ type: "null" }, { type: "array", items: statusItem }],
      default: []
    }
  },
  additionalProperties: false
};
