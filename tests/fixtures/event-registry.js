/* ═══ THE EVENT REGISTRY — HOUSE-MIND S1 (docs/design/HOUSE-MIND.md §5) ════════
   Every event on `src/js/core/eventBus.js`, who publishes it and who hears it.

   This table is DECLARED, and tests/event-registry.spec.js DERIVES the same
   facts from the source and goes red on any difference — the same pattern as
   tests/flag-surface.spec.js and its INERT-ON-V3 marks. What it exists to stop:
   an event with no listener fails SILENTLY. Before S0, `arrival:home` was heard
   on V3 and published only by the incumbent, `intent:changed` was published and
   heard by nothing, and nothing in the suite noticed either.

   A row:
     publishers   files that emit it (a declared relay such as commands.js's
                  `record()` counts as its caller's emit)
     consumers    files that subscribe with `on()`
     orphanOnV3 / orphanOnIncumbent
                  present ONLY when, within that surface's import closure, the
                  event is published and unheard ("unheard") or heard and never
                  published ("unpublished") — and that is KNOWN AND ACCEPTED.
                  `why` says why it is not a dead lever. The spec goes red on an
                  orphan with no entry AND on an entry that no longer applies.

   ⚠ A red orphan is not a row to add until green. It means a lever just went
   dead (or a new one was built unwired) on a live surface. Read the change that
   did it first. Only an orphan that is harmless by design earns an entry.

   ⚠ Static, like flag-surface: "published on V3" means a module in V3's import
   closure contains the emit. A flag-gated emit (`arrival:home` behind
   v3ArrivalDelight) counts as published with the flag off — which flag is a
   live lever is flag-surface's job, not this table's.
   ════════════════════════════════════════════════════════════════════════ */

export const EVENTS = {
  "arrival:home": {
    publishers: ["src/js/modules/arrivalGreeting.js", "src/v3/core/arrival.js"],
    consumers: ["src/js/core/personalityRuntime.js"]
  },
  "attention:hero": {
    publishers: ["src/js/services/attentionEngine.js"],
    consumers: ["src/js/core/memoryRuntime.js", "src/js/core/routineRuntime.js"]
  },
  "bins:updated": {
    publishers: ["src/js/modules/binReminder.js"],
    consumers: [
      "src/js/modules/ambientArchive.js",
      "src/js/modules/calendar.js",
      "src/js/modules/daySources.js",
      "src/js/modules/temporalSpine.js"
    ]
  },
  "calendar:refreshed": {
    publishers: ["src/js/modules/calendar.js"],
    consumers: [
      "src/js/modules/ambientArchive.js",
      "src/js/modules/recipePanel.js",
      "src/js/modules/systemStatus.js",
      "src/js/modules/temporalSpine.js",
      "src/js/modules/tonightsMenu.js"
    ]
  },
  "cameras:status": {
    publishers: ["src/js/modules/cameraTiles.js"],
    consumers: ["src/js/modules/systemStatus.js"]
  },
  "command:executed": {
    publishers: ["src/js/services/homeAssistant/events.js", "src/v3/core/commands.js"],
    consumers: ["src/js/core/voiceOverlay.js"],
    orphanOnV3: {
      kind: "unheard",
      why:
        "Emitted in the incumbent's shape so a later V3 consumer meets one contract. " +
        "V3 records the outcome in commands.js's `last` instead (read over CDP and by specs)."
    }
  },
  "command:unknown": {
    publishers: ["src/js/services/homeAssistant/events.js", "src/v3/core/commands.js"],
    consumers: ["src/js/core/voiceOverlay.js"],
    orphanOnV3: {
      kind: "unheard",
      why: "As command:executed: V3's refusal is recorded in commands.js's `last`, not heard on the bus."
    }
  },
  dashboard_command: {
    publishers: ["src/js/services/homeAssistant/events.js"],
    consumers: [
      "src/js/core/voiceOverlay.js",
      "src/js/modules/cameraPopupOverlay.js",
      "src/js/modules/cameraTiles.js"
    ]
  },
  "delight:fired": {
    publishers: ["src/js/core/personalityRuntime.js"],
    consumers: ["src/js/modules/arrivalGreeting.js"],
    orphanOnV3: {
      kind: "unheard",
      why:
        "Its one listener arms the incumbent arrival card's warm variant. V3 has no arrival " +
        "card; the delight reaches V3 through collectDelight(), which the attention engine polls."
    }
  },
  "ha:connected": {
    publishers: ["src/js/services/homeAssistant/client.js"],
    consumers: [
      "src/js/modules/cameraTiles.js",
      "src/js/modules/mediaStatus.js",
      "src/js/modules/systemStatus.js"
    ],
    orphanOnV3: {
      kind: "unheard",
      why: "The HA client is shared and announces the stream either way; no V3 module subscribes."
    }
  },
  "ha:disconnected": {
    publishers: ["src/js/services/homeAssistant/client.js"],
    consumers: [
      "src/js/modules/cameraTiles.js",
      "src/js/modules/mediaStatus.js",
      "src/js/modules/systemStatus.js"
    ],
    orphanOnV3: {
      kind: "unheard",
      why: "As ha:connected: the shared client's announcement, with no V3 subscriber."
    }
  },
  "ha:event:dashboard_command": {
    publishers: ["src/js/services/homeAssistant/client.js", "src/v3/core/commands.js"],
    consumers: ["src/js/services/homeAssistant/events.js", "src/v3/core/commands.js"]
  },
  "ha:event:state_changed": {
    publishers: ["src/js/services/homeAssistant/client.js"],
    consumers: ["src/js/modules/systemStatus.js", "src/js/services/homeAssistant/entityFeed.js"]
  },
  "ha:state-updated": {
    publishers: ["src/js/services/homeAssistant/entityFeed.js", "src/v3/main.js"],
    consumers: [
      "src/js/core/routineRuntime.js",
      "src/js/services/homeAssistant/events.js",
      "src/v3/core/alerts.js",
      "src/v3/core/arrival.js",
      "src/v3/core/media-rooms.js",
      "src/v3/core/now-playing.js",
      "src/v3/core/presence.js"
    ]
  },
  "ha:states": {
    publishers: ["src/js/services/homeAssistant/client.js"],
    consumers: ["src/js/services/homeAssistant/entityFeed.js"]
  },
  "ha:todo-items": {
    publishers: ["src/js/services/homeAssistant/client.js"],
    consumers: ["src/js/services/homeAssistant/entityFeed.js"]
  },
  /* HOUSE-MIND S2: the observation store's reads, relayed from
     /api/house/stream. Each consumer is behind its own v3HouseStore* flag. */
  "house:observation": {
    publishers: ["src/js/services/houseStream.js"],
    consumers: [
      "src/js/core/intentEngine.js",
      "src/js/core/personalityRuntime.js",
      "src/js/modules/briefingData.js",
      "src/js/services/houseSnapshot.js",
      "src/js/services/voiceSnapshot.js",
      "src/v3/main.js"
    ]
  },
  "presence:changed": {
    publishers: ["src/js/core/presence.js", "src/v3/core/presence.js"],
    consumers: [
      "src/js/core/intentEngine.js",
      "src/js/core/routineRuntime.js",
      "src/js/modules/focusHero.js",
      "src/js/modules/temporalSpine.js",
      "src/v3/core/context-feed.js"
    ]
  },
  "screensaver:changed": {
    publishers: ["src/js/modules/screensaver.js"],
    consumers: ["src/js/core/presence.js", "src/js/services/atmoFx/runtime.js"]
  },
  "sound:presence": {
    publishers: ["src/v3/core/presence-light.js", "src/v3/main.js"],
    consumers: ["src/v3/core/presence.js"]
  },
  "status:highlight": {
    publishers: ["src/js/services/homeAssistant/events.js"],
    consumers: ["src/js/modules/systemStatus.js"]
  },
  "timeline:scroll": {
    publishers: ["src/js/services/homeAssistant/events.js"],
    consumers: ["src/js/modules/calendar.js"]
  },
  "todos:updated": {
    publishers: ["src/js/modules/todo.js"],
    consumers: ["src/js/modules/calendar.js"]
  },
  "view:changed": {
    publishers: ["src/js/core/viewManager.js"],
    consumers: [
      "src/js/core/lifecycle.js",
      "src/js/modules/cameraTiles.js",
      "src/js/modules/mediaPanels.js",
      "src/js/services/weather/radar.js",
      "src/js/services/weather/renderer.js"
    ]
  },
  "weather:refreshed": {
    publishers: ["src/js/services/weather/renderer.js"],
    consumers: ["src/js/modules/systemStatus.js"]
  }
};

/* Local wrappers that emit on the caller's behalf. The spec reads each call of
   `fn` in `file` as an emit of its first (literal) argument, and accepts the
   ONE non-literal bus call inside it. A new wrapper anywhere else is reported
   as a call form the scan does not understand — never silently skipped. */
export const RELAYS = [{ file: "src/v3/core/commands.js", fn: "record", param: "event" }];
