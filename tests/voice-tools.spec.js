import { test, expect } from "@playwright/test";

import { VOICE_ENTITIES, toolDefs, entityRoster, planCall } from "../server/services/voiceTools.js";
import { SAFE_SERVICES } from "../server/ha/haRoutes.js";

// Lane 3's hands. playwright.config.js stubs ANTHROPIC_API_KEY to "", so the
// Claude leg never runs in this suite and the tool loop cannot be integration
// tested — which is exactly why everything that decides whether a call is
// ALLOWED lives in a pure module. This spec is the only thing standing between
// a bad tool definition and a voice model actuating the house, so it tests the
// boundary rather than the happy path.

const ids = (domain) => VOICE_ENTITIES.filter(e => e.id.startsWith(`${domain}.`)).map(e => e.id);
const defsByName = () => Object.fromEntries(toolDefs().map(d => [d.name, d]));

test.describe("tool definitions", () => {
  test("every definition is strict and closed", () => {
    const defs = toolDefs();
    expect(defs.length, "roster produced no tools at all").toBeGreaterThan(0);

    for (const def of defs) {
      expect(def.strict, `${def.name} is not strict`).toBe(true);
      expect(def.input_schema.additionalProperties, `${def.name} accepts extra props`).toBe(false);
      // strict mode requires EVERY property in `required` — an optional
      // parameter is expressed as "or null", never by omission. A property
      // missing from required is a schema-compile 400 at request time, which
      // would surface on the kiosk as a voice lane that silently stopped working.
      expect(
        Object.keys(def.input_schema.properties).sort(),
        `${def.name}: required must cover every property`
      ).toEqual([...def.input_schema.required].sort());
    }
  });

  test("entity_id is an enum drawn from the roster, never a free string", () => {
    const rosterIds = new Set(VOICE_ENTITIES.map(e => e.id));
    for (const def of toolDefs()) {
      const enumerated = def.input_schema.properties.entity_id.enum;
      expect(Array.isArray(enumerated), `${def.name}: entity_id is not an enum`).toBe(true);
      expect(enumerated.length).toBeGreaterThan(0);
      for (const id of enumerated) {
        expect(rosterIds.has(id), `${def.name} offers ${id}, which is not on the roster`).toBe(true);
      }
    }
  });

  test("no schema carries a constraint structured outputs cannot compile", () => {
    // Found by review, not by this suite: the first draft put minimum/maximum on
    // brightness_pct and volume_pct. Structured outputs do not support numerical
    // or string constraints, and a strict schema carrying one risks a 400 at
    // request time — invisible here (no API key) and visible on the kiosk as a
    // voice lane that died the moment someone mentioned a light. Ranges are
    // enforced in planCall instead; this keeps them from creeping back.
    const BANNED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
                    "multipleOf", "minLength", "maxLength", "pattern",
                    "minItems", "maxItems"];

    const walk = (node, path, toolName) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`, toolName));
      for (const key of Object.keys(node)) {
        expect(
          BANNED.includes(key),
          `${toolName}: ${path}.${key} is not supported in a strict schema`
        ).toBe(false);
        walk(node[key], `${path}.${key}`, toolName);
      }
    };

    for (const def of toolDefs()) walk(def.input_schema, "input_schema", def.name);
  });

  test("a domain with no roster entry produces no tool", () => {
    const names = new Set(toolDefs().map(d => d.name));
    // The seeded roster has media players and (until seeded on the box) no
    // lights. Whichever way it is filled in, the tool and the entities must
    // agree — an unseeded domain must not ship an empty-enum tool, which is
    // both a schema error and an invitation to hallucinate an entity.
    if (!ids("light").length) expect(names.has("set_light")).toBe(false);
    if (!ids("switch").length) expect(names.has("set_switch")).toBe(false);
    if (!ids("script").length && !ids("scene").length) expect(names.has("run_routine")).toBe(false);
    if (!ids("media_player").length) expect(names.has("control_media")).toBe(false);
  });
});

test.describe("planCall — the boundary", () => {
  test("rejects an entity that is not on the roster", () => {
    // The load-bearing case. A model that invents an entity id — through a bad
    // retry, a relaxed schema, or a model swap — must not actuate anything.
    for (const forged of ["lock.front_door", "cover.garage", "light.does_not_exist", "", null]) {
      const out = planCall("set_light", { entity_id: forged, state: "off", brightness_pct: null });
      expect(out.ok, `${forged} was allowed through`).toBe(false);
    }
  });

  test("rejects a tool pointed at the wrong domain", () => {
    const media = ids("media_player")[0];
    expect(media, "roster seed lost its media players").toBeTruthy();
    // A media player is on the roster, so the entity check passes — the domain
    // check is what has to stop this.
    expect(planCall("set_light", { entity_id: media, state: "on", brightness_pct: null }).ok).toBe(false);
    expect(planCall("run_routine", { entity_id: media }).ok).toBe(false);
  });

  test("rejects an unknown tool name", () => {
    const any = VOICE_ENTITIES[0].id;
    expect(planCall("delete_everything", { entity_id: any }).ok).toBe(false);
  });

  test("rejects out-of-range brightness and volume", () => {
    const media = ids("media_player")[0];
    for (const pct of [-1, 101, 1.5, "8", null]) {
      const out = planCall("control_media", { entity_id: media, action: "volume", volume_pct: pct });
      expect(out.ok, `volume ${pct} was allowed`).toBe(false);
    }
  });

  test("translates a valid media call, and percent becomes HA's 0-1", () => {
    const media = ids("media_player")[0];
    expect(planCall("control_media", { entity_id: media, action: "pause", volume_pct: null }))
      .toMatchObject({ ok: true, domain: "media_player", service: "media_pause" });

    const vol = planCall("control_media", { entity_id: media, action: "volume", volume_pct: 40 });
    expect(vol).toMatchObject({ ok: true, service: "volume_set" });
    expect(vol.body.volume_level).toBe(0.4);
  });

  test("brightness rides turn_on and never turn_off", () => {
    const light = ids("light")[0];
    test.skip(!light, "no lights on the roster yet — seed VOICE_ENTITIES on the G11");

    const on = planCall("set_light", { entity_id: light, state: "on", brightness_pct: 60 });
    expect(on).toMatchObject({ ok: true, service: "turn_on" });
    expect(on.body.brightness_pct).toBe(60);

    // HA rejects brightness on turn_off; a model that sends both must not
    // produce a call that 400s at the house.
    const off = planCall("set_light", { entity_id: light, state: "off", brightness_pct: 60 });
    expect(off).toMatchObject({ ok: true, service: "turn_off" });
    expect(off.body).not.toHaveProperty("brightness_pct");
  });
});

// The guard that makes the two allowlists provably agree.
//
// ⚠ THE OBVIOUS FORM OF THIS TEST IS VACUOUS. Asserting "if planCall allows it,
// the service is safe" can never fail: planCall's own last line is that same
// SAFE_SERVICES check, so a tool wired to an unsafe service returns ok:false and
// a `continue` skips it. Verified by wiring run_routine to script.toggle — the
// test stayed green.
//
// So the assertion is the other way round: every input a tool definition
// PERMITS must be ALLOWED, and land on a safe service. A tool whose intended
// service is not allowlisted then fails here as "can never do anything" —
// which is its real failure mode: the model calls it, planCall refuses every
// time, and the house says "not allowlisted" forever while the code looks fine.
test("every input the tool definitions permit is allowed, on a safe service", () => {
  const ACTIONS = {
    set_light: [{ state: "on", brightness_pct: null }, { state: "on", brightness_pct: 50 }, { state: "off", brightness_pct: null }],
    set_switch: [{ state: "on" }, { state: "off" }],
    run_routine: [{}],
    control_media: [
      { action: "play", volume_pct: null },
      { action: "pause", volume_pct: null },
      { action: "stop", volume_pct: null },
      { action: "volume", volume_pct: 50 }
    ]
  };

  let allowed = 0;
  for (const def of toolDefs()) {
    const variants = ACTIONS[def.name];
    expect(variants, `${def.name} has no coverage in this guard — add it`).toBeTruthy();

    for (const entityId of def.input_schema.properties.entity_id.enum) {
      for (const variant of variants) {
        const out = planCall(def.name, { entity_id: entityId, ...variant });
        expect(
          out.ok,
          `${def.name} refuses a call its own schema permits ` +
            `(${entityId}, ${JSON.stringify(variant)}): ${out.reason}. ` +
            "The tool is a dead letter — its service is not in SAFE_SERVICES."
        ).toBe(true);
        allowed += 1;
        const key = `${out.domain}.${out.service}`;
        expect(SAFE_SERVICES.has(key), `${def.name} emitted ${key}, which is not allowlisted`).toBe(true);
      }
    }
  }

  // Belt and braces: a roster that produced no tools would pass vacuously.
  expect(allowed, "no combination was exercised — the guard proved nothing").toBeGreaterThan(0);
});

// The roster is the whole security surface — everything else in this file
// assumes it was curated with care. This is the one invariant about its
// CONTENTS, not its plumbing: the house's switch.* domain is overwhelmingly
// Eufy camera configuration (~60 of it), and a voice model that can turn off
// switch.doorbell_motion_detection can break the motion-wake chain and the
// cameras in one sentence. recoveryService.js exists to re-arm exactly these.
test("no camera-config or appliance-settings switch is voice-reachable", () => {
  const FORBIDDEN = /_(motion_detection|camera_enabled|status_led|audio_recording|microphone|speaker|rtsp_stream|antitheft_detection|auto_nightvision|pet_detection|motion_tracking)|^switch\.(roborock|qbittorrent)|_notification_/;

  for (const entity of VOICE_ENTITIES) {
    expect(
      FORBIDDEN.test(entity.id),
      `${entity.id} is a settings toggle, not something to ask for out loud`
    ).toBe(false);
  }

  // Dashboard navigation belongs to the local lane, which matches it without a
  // model round-trip. Listing it here invites the house voice to change the
  // view when someone asked it a question.
  for (const entity of VOICE_ENTITIES) {
    expect(entity.id.startsWith("script.dashboard_"), `${entity.id} is navigation`).toBe(false);
  }
});

test("the roster line is empty when the roster is, and names every entity when not", () => {
  const line = entityRoster();
  if (!VOICE_ENTITIES.length) {
    expect(line).toBe("");
    return;
  }
  for (const entity of VOICE_ENTITIES) {
    expect(line, `${entity.id} is missing from the prompt roster`).toContain(entity.id);
    expect(line, `${entity.name} is missing from the prompt roster`).toContain(entity.name);
  }
});
