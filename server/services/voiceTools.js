import { SAFE_SERVICES } from "../ha/haRoutes.js";

// Lane 3's hands (docs/vision/phase-4-voice.md). The house voice could always
// TALK about the lights; this is what lets it turn them off.
//
// Lane 2 (HA Assist) drives the house through HA's sentence templates, so it
// only acts on phrasings someone wrote a template for. Anything it misses falls
// to Lane 3, where Claude answered in words and the light stayed on. These tools
// close that gap WITHOUT widening the security boundary: every call is validated
// against the same SAFE_SERVICES set that gates /api/ha/services.
//
// PURE ON PURPOSE — no HA calls, no network, no env reads. playwright.config.js
// stubs ANTHROPIC_API_KEY to "", so the Claude leg never executes in the suite
// and an integration test of the tool loop is impossible. Everything that
// decides whether a call is ALLOWED therefore lives here, where a unit spec can
// reach it directly (same shape as voiceShape.js and soundPresence.js).

// The roster. Only what is named here is reachable, and only these names are
// ever sent upstream — the whole point of curating rather than discovering: the
// house's full device inventory does not leave the LAN.
//
// ⚠ SEED THIS ON THE G11 BEFORE FLIPPING THE FLAG. The repo does not know the
// house's light/switch/script entity ids (nothing in src/ or server/ references
// one), so inventing them here would ship a roster that silently matches
// nothing. Read the real ids and fill them in:
//
//   ssh pi-dashboard "curl -s localhost:3000/api/ha/states" \
//     | grep -o '\"entity_id\":\"\(light\|switch\|script\|scene\|media_player\)[^\"]*\"'
//
// `name` is what a person would say out loud, not HA's friendly_name — it is
// the only description of the entity the model gets.
// Seeded 2026-08-12 from the live G11's /api/ha/states, not from the repo —
// src/js/core/config.js:57 still names `media_player.lounge_room`, which DOES
// NOT EXIST (the real one is `lounge_hub`). A roster copied from the codebase
// would have shipped an entity the house has never heard of.
export const VOICE_ENTITIES = [
  // The outdoor floodlights. They are Eufy camera lights, so HA models them as
  // switches, not lights — "turn on the backyard light" is a set_switch call.
  { id: "switch.backyard_light", name: "backyard light" },
  { id: "switch.driveway_light", name: "driveway light" },
  { id: "switch.front_yard_light", name: "front yard light" },
  { id: "switch.patio_light", name: "patio light" },
  { id: "switch.side_gate_light", name: "side gate light" },

  // The only two house scenes. Everything else under script.* is dashboard
  // NAVIGATION (script.dashboard_show_weather and ~40 siblings) — those belong
  // to the local lane, which already matches them without a model round-trip,
  // and listing them here would only invite the house voice to change the view
  // when someone asked it a question.
  { id: "scene.mode_goodnight", name: "goodnight" },
  { id: "scene.mode_movie", name: "movie mode" },

  // Rooms, not device models: the house has kd_55x8500c and four near-duplicate
  // `_2` entries that no one would ever say out loud.
  { id: "media_player.living_room", name: "living room" },
  { id: "media_player.piano_room", name: "piano room" },
  { id: "media_player.lounge_hub", name: "lounge" },
];

// DELIBERATELY ABSENT, and worth stating so nobody "helpfully" adds them:
//   · every switch.*_motion_detection / _camera_enabled / _status_led / _rtsp_
//     — the Eufy camera config surface. Turning one off breaks the motion-wake
//     chain and the cameras, and recoveryService.js exists precisely to re-arm
//     them. A voice model must not be able to reach it.
//   · switch.roborock_* and switch.qbittorrent_* — settings, not requests.
//   · script.dashboard_* — see above.
//
// There are NO light.* entities in this house at all (checked: zero). set_light
// therefore ships inert — toolDefs() emits it only if a light ever appears.

const DOMAIN_OF = (entityId) => String(entityId).split(".")[0];

/** Entities of a given domain, in roster order (stable — see the caching note). */
function idsIn(...domains) {
  return VOICE_ENTITIES.filter((e) => domains.includes(DOMAIN_OF(e.id))).map((e) => e.id);
}

// A nullable optional. `strict: true` requires every property to appear in
// `required`, so an optional parameter is expressed as "or null" rather than by
// omission — leaving it out of `required` is rejected at schema-compile time.
//
// NO `minimum`/`maximum` HERE, deliberately. Structured outputs do not support
// numerical constraints, and a strict schema carrying them risks a 400 at
// request time — which would surface as a voice lane that stopped working the
// moment someone asked for a light, and nowhere earlier. The range is stated in
// the description for the model and ENFORCED in planCall(), which is where a
// bound belongs anyway: the schema is a request, planCall is the guarantee.
const NULLABLE_INT = { anyOf: [{ type: "integer" }, { type: "null" }] };

/**
 * The tool definitions handed to the Messages API.
 *
 * entity_id is an `enum` drawn from VOICE_ENTITIES, so the model cannot even
 * NAME an entity that is not on the roster — the guard sits in the schema, not
 * only in our validation. planCall() re-checks anyway; a tool definition is a
 * request to the model, never a guarantee about what comes back.
 *
 * `strict: true` is supported on claude-haiku-4-5 (the ANTHROPIC_MODEL default).
 * If that env var is ever pointed at a model without structured-output support,
 * these definitions are what would 400 first.
 *
 * Returns [] when no entity of the relevant domain is on the roster — an
 * unseeded roster produces NO tools, which makes the request byte-identical to
 * the flag-off path. Seeding and flipping the flag are two separate acts.
 */
export function toolDefs() {
  const lights = idsIn("light");
  const switches = idsIn("switch");
  const routines = idsIn("script", "scene");
  const media = idsIn("media_player");
  const defs = [];

  if (lights.length) {
    defs.push({
      name: "set_light",
      description:
        "Turn a light on or off, optionally at a brightness. Use for any request to " +
        "change a light in the house.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          entity_id: { type: "string", enum: lights, description: "Which light." },
          state: { type: "string", enum: ["on", "off"] },
          brightness_pct: {
            ...NULLABLE_INT,
            description: "Brightness as a whole number from 1 to 100 when turning on. Null to leave it as is."
          }
        },
        required: ["entity_id", "state", "brightness_pct"],
        additionalProperties: false
      }
    });
  }

  if (switches.length) {
    defs.push({
      name: "set_switch",
      description: "Turn a switch on or off.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          entity_id: { type: "string", enum: switches, description: "Which switch." },
          state: { type: "string", enum: ["on", "off"] }
        },
        required: ["entity_id", "state"],
        additionalProperties: false
      }
    });
  }

  if (routines.length) {
    defs.push({
      name: "run_routine",
      description:
        "Run a household routine or scene. These are one-shot — there is no way to " +
        "stop one once it starts, so only run one when it is clearly what was asked for.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          entity_id: { type: "string", enum: routines, description: "Which routine." }
        },
        required: ["entity_id"],
        additionalProperties: false
      }
    });
  }

  if (media.length) {
    defs.push({
      name: "control_media",
      description: "Play, pause, or stop a media player, or set its volume.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          entity_id: { type: "string", enum: media, description: "Which player." },
          action: { type: "string", enum: ["play", "pause", "stop", "volume"] },
          volume_pct: {
            ...NULLABLE_INT,
            description: "Volume as a whole number from 0 to 100. Required when action is volume, otherwise null."
          }
        },
        required: ["entity_id", "action", "volume_pct"],
        additionalProperties: false
      }
    });
  }

  return defs;
}

/**
 * The roster as a system-prompt line. Appended only when the lane is armed, so
 * the flag-off prompt is unchanged byte for byte.
 */
export function entityRoster() {
  if (!VOICE_ENTITIES.length) return "";
  const list = VOICE_ENTITIES.map((e) => `${e.name} (${e.id})`).join(", ");
  return (
    `You can control these things in the house, and nothing else: ${list}. ` +
    "Use a tool when someone asks you to change something; answer in words when they " +
    "are only asking. If they ask for something you have no tool for, say plainly that " +
    "you can't do that one — never pretend you did it."
  );
}

const ENTITY_IDS = new Set(VOICE_ENTITIES.map((e) => e.id));

function reject(reason) {
  return { ok: false, reason };
}

/**
 * Validate one tool_use block and translate it into an HA service call.
 *
 * This is the load-bearing check, and it deliberately repeats work the schema
 * already did. `strict` constrains what the model emits; it says nothing about
 * what arrives here after a retry, a model swap, or a future edit that relaxes
 * a schema. Two invariants hold regardless of input:
 *   1. the entity is on the roster
 *   2. the resulting domain.service is in SAFE_SERVICES
 *
 * @returns {{ok: true, domain: string, service: string, body: object}
 *          |{ok: false, reason: string}}
 */
export function planCall(toolName, input) {
  const entityId = input?.entity_id;
  if (typeof entityId !== "string" || !ENTITY_IDS.has(entityId)) {
    return reject(`${entityId ?? "that"} is not something I can control`);
  }

  const domain = DOMAIN_OF(entityId);
  let service = null;
  const body = { entity_id: entityId };

  switch (toolName) {
    case "set_light": {
      if (domain !== "light") return reject(`${entityId} is not a light`);
      if (input.state !== "on" && input.state !== "off") return reject("unknown light state");
      service = input.state === "on" ? "turn_on" : "turn_off";
      // Brightness only means anything on the way on; HA rejects it on turn_off.
      if (service === "turn_on" && Number.isInteger(input.brightness_pct)) {
        if (input.brightness_pct < 1 || input.brightness_pct > 100) {
          return reject("brightness must be between 1 and 100");
        }
        body.brightness_pct = input.brightness_pct;
      }
      break;
    }

    case "set_switch": {
      if (domain !== "switch") return reject(`${entityId} is not a switch`);
      if (input.state !== "on" && input.state !== "off") return reject("unknown switch state");
      service = input.state === "on" ? "turn_on" : "turn_off";
      break;
    }

    case "run_routine": {
      if (domain !== "script" && domain !== "scene") return reject(`${entityId} is not a routine`);
      service = "turn_on";
      break;
    }

    case "control_media": {
      if (domain !== "media_player") return reject(`${entityId} is not a media player`);
      const map = { play: "media_play", pause: "media_pause", stop: "media_stop", volume: "volume_set" };
      service = map[input.action] ?? null;
      if (!service) return reject("unknown media action");
      if (service === "volume_set") {
        if (!Number.isInteger(input.volume_pct) || input.volume_pct < 0 || input.volume_pct > 100) {
          return reject("volume must be between 0 and 100");
        }
        // HA takes 0-1; the tool speaks percent because people do.
        body.volume_level = Math.round(input.volume_pct) / 100;
      }
      break;
    }

    default:
      return reject(`unknown tool ${toolName}`);
  }

  // The boundary. Everything above is translation; this is the gate, and it
  // reads the SAME set /api/ha/services enforces (server/ha/haRoutes.js).
  const key = `${domain}.${service}`;
  if (!SAFE_SERVICES.has(key)) return reject(`${key} is not allowlisted`);

  return { ok: true, domain, service, body };
}
