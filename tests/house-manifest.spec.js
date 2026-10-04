import { test, expect } from "@playwright/test";
import { readdirSync } from "fs";
import { join } from "path";
import { root, rel, codeOf } from "./fixtures/source-scan.js";
import { CAPABILITIES, CALLERS, converseReads } from "../server/services/houseManifest.js";
import { toolDefs, planCall, VOICE_ENTITIES } from "../server/services/voiceTools.js";
import { SAFE_SERVICES } from "../server/ha/haRoutes.js";
import { converseSystem } from "../server/routes/voice.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE-MIND S8 — the house's tool manifest (docs/design/HOUSE-MIND.md §S8).

   S8a. The table is DECLARED; this derives the truth from the source and goes
   red on the three things the design names:
     · an AI-facing input the manifest does not declare
     · an act that is not behind SAFE_SERVICES
     · a declared capability that nothing calls
   S8b. /converse built from the manifest is byte-identical to the hand
   assembly, for the same inputs, in both flag states.
   ═══════════════════════════════════════════════════════════════════════════ */

function serverFiles(dir = join(root, "server"), out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== "node_modules" && ent.name !== "tts-cache") serverFiles(full, out); }
    else if (ent.name.endsWith(".js")) out.push(full);
  }
  return out;
}
const code = (relPath) => codeOf(join(root, relPath));
const rows = (kind) => CAPABILITIES.filter((r) => r.kind === kind);

/** The body of `export function converseSystem(...) { ... }`, comments stripped. */
function converseSystemBody() {
  const src = code(CALLERS.converse);
  const start = src.indexOf("export function converseSystem(");
  const end = src.indexOf("\n}\n", start);
  expect(start, "converseSystem not found").toBeGreaterThan(-1);
  return src.slice(start, end);
}

test.describe("S8a — every AI-facing input is declared", () => {
  test("every server file that talks to a model is a declared caller, and no other", () => {
    const talkers = serverFiles()
      .filter((f) => /from\s+["']@anthropic-ai\/sdk["']/.test(codeOf(f)))
      .map(rel)
      .sort();
    expect(talkers.length).toBeGreaterThan(2);   // the scan found them
    expect(talkers).toEqual(Object.values(CALLERS).sort());
  });

  test("every renderer the converse prompt calls is a declared read", () => {
    const body = converseSystemBody();
    // What converseSystem appends to the prompt: the *Context renderers, the
    // tool roster, and (S8b) the manifest's own block.
    const called = [...new Set([...body.matchAll(/\b(\w+Context|entityRoster)\(/g)].map((m) => m[1]))].sort();
    expect(called).toContain("houseContext");    // the parse found the body
    const declared = rows("read").filter((r) => r.callers.includes("converse")).map((r) => r.backing).sort();
    expect(called).toEqual(declared);
  });

  test("every tool a model is handed is a declared row", () => {
    /* toolDefs() hands out only the tools the roster can use (no light is
       rostered today, so set_light is not offered), so "handed" is a subset.
       The full set is what planCall can translate, and that is what the
       manifest must equal: a tool that would be offered the day a light is
       rostered is already declared, and already behind the gate. */
    const declared = rows("act").map((r) => r.name).sort();
    const handed = toolDefs().map((t) => t.name);
    expect(handed.length).toBeGreaterThan(0);      // the roster is seeded
    for (const name of handed) expect(declared, `${name} is handed to the model but not declared`).toContain(name);
    const handled = [...code("server/services/voiceTools.js").matchAll(/case "(\w+)":\s*\{/g)].map((m) => m[1]).sort();
    expect(handled.length).toBeGreaterThan(0);     // the parse found planCall's cases
    expect(declared).toEqual(handled);

    // Any other tool list in server/ (the recipe route's web search).
    const others = new Set();
    for (const f of serverFiles()) {
      if (rel(f) === "server/services/voiceTools.js") continue;
      for (const m of codeOf(f).matchAll(/tools:\s*\[\s*\{[^}]*name:\s*"(\w+)"/g)) others.add(m[1]);
    }
    expect([...others]).toEqual(["web_search"]);
    expect(CAPABILITIES.filter((r) => r.backing === "web_search").map((r) => r.name)).toEqual(["recipe.search"]);
  });

  test("each row is well formed, and names no entity", () => {
    const names = CAPABILITIES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const r of CAPABILITIES) {
      expect(["read", "act"]).toContain(r.kind);
      expect(r.gate, `${r.name} has no gate`).toBeTruthy();
      expect(r.callers.length, `${r.name} has no caller`).toBeGreaterThan(0);
      for (const c of r.callers) expect(Object.keys(CALLERS)).toContain(c);
    }
    const text = JSON.stringify(CAPABILITIES);
    for (const e of VOICE_ENTITIES) expect(text).not.toContain(e.id);
  });
});

test.describe("S8a — every act is behind SAFE_SERVICES", () => {
  /* One valid call per act, built from the roster's own entities. A tool with
     no rostered entity in its domain cannot act at all, which is asserted
     rather than skipped. */
  const DOMAIN = { set_light: ["light"], set_switch: ["switch"], run_routine: ["scene", "script"], control_media: ["media_player"] };
  const INPUT = { set_light: { state: "on" }, set_switch: { state: "on" }, run_routine: {}, control_media: { action: "pause" } };
  const entityFor = (tool) => VOICE_ENTITIES.find((e) => DOMAIN[tool].includes(e.id.split(".")[0]));

  test("the manifest says so", () => {
    expect(rows("act").length).toBeGreaterThan(0);
    for (const r of rows("act")) {
      expect(r.gate).toBe("SAFE_SERVICES");
      expect(r.backing).toBe("planCall");
      expect(r.render).toBeUndefined();
    }
  });

  for (const tool of Object.keys(DOMAIN)) {
    test(`${tool}: allowed with the allowlist intact, refused the moment its service leaves it`, () => {
      expect(rows("act").map((r) => r.name)).toContain(tool);
      const entity = entityFor(tool);
      if (!entity) {
        // Nothing rostered in this domain: every call is refused before the gate.
        expect(planCall(tool, { entity_id: "light.spec", ...INPUT[tool] }).ok).toBe(false);
        return;
      }
      const input = { entity_id: entity.id, ...INPUT[tool] };
      const plan = planCall(tool, input);
      expect(plan.ok, plan.reason).toBe(true);

      const key = `${plan.domain}.${plan.service}`;
      expect(SAFE_SERVICES.has(key)).toBe(true);
      SAFE_SERVICES.delete(key);
      try {
        const refused = planCall(tool, input);
        expect(refused.ok).toBe(false);
        expect(refused.reason).toContain("not allowlisted");
      } finally {
        SAFE_SERVICES.add(key);
      }
    });
  }
});

test.describe("S8a — every declared capability is called", () => {
  test("each row's backing is used in each of its callers", () => {
    for (const r of CAPABILITIES) {
      for (const c of r.callers) {
        const src = code(CALLERS[c]);
        const used = r.backing === "web_search" ? src.includes('name: "web_search"') : new RegExp(`\\b${r.backing}\\(`).test(src);
        expect(used, `${r.name}: nothing in ${CALLERS[c]} calls ${r.backing}`).toBe(true);
      }
    }
  });

  test("an act's tool name is one planCall handles", () => {
    const src = code("server/services/voiceTools.js");
    for (const r of rows("act")) expect(src, r.name).toContain(`case "${r.name}":`);
  });
});

/* ── S8b ─────────────────────────────────────────────────────────────────── */

const T = (hh, mm = 0) => Date.UTC(2026, 6, 5, 14 + hh, mm);
const DIGEST = { known: { weather: "19°, clear", calendar: "Dentist at 3" }, blind: ["the cameras"] };
const CLAIMS = {
  ready: true, observedDays: 11, since: "2026-06-25", until: "2026-07-06", continuous: true, gapDays: 0,
  today: { day: "2026-07-06", obsLow: 9, obsHigh: 21 }, todayHolds: [],
  records: { coldest: { noun: "coldest morning", scope: "in 11 days", value: 7, day: "2026-07-01", clear: true } }
};
const HOUSE_CLAIMS = {
  ready: true, observedDays: 9, since: "2026-06-27", until: "2026-07-06", continuous: false, gapDays: 1,
  groups: { door: { label: "At the door", total: 14, scope: "in 9 days", today: 2, busiest: { day: "2026-07-04", value: 5, clear: true }, quiet: [] } },
  occupancy: { ready: false }
};
const TODAY = { day: "2026-07-06", since: T(6, 55), entries: [{ at: T(17, 30), kind: "condition", from: "Cloudy", to: "Rain" }] };

const CASES = {
  "everything": [DIGEST, CLAIMS, HOUSE_CLAIMS, TODAY],
  "nothing": [null, null, null, null],
  "the digest alone": [DIGEST, null, null, null],
  "the records alone": [null, CLAIMS, HOUSE_CLAIMS, null],
  "today alone": [null, null, null, TODAY]
};

test.describe("S8b — converse built from the manifest is byte-identical", () => {
  const KEYS = ["VOICE_HOUSE_CONTEXT", "CONVERSE_MANIFEST", "HOUSE_CHARACTER_ENABLED", "VAULT_ENABLED"];
  let saved;
  test.beforeEach(() => {
    saved = KEYS.map((k) => process.env[k]);
    for (const k of KEYS) delete process.env[k];
  });
  test.afterEach(() => {
    KEYS.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  });

  const build = (manifest, args) => {
    if (manifest) process.env.CONVERSE_MANIFEST = "1"; else delete process.env.CONVERSE_MANIFEST;
    return converseSystem("what's the day been like", [], ...args);
  };

  for (const [label, args] of Object.entries(CASES)) {
    test(`house context on, ${label}: the two assemblies agree`, () => {
      process.env.VOICE_HOUSE_CONTEXT = "1";
      const hand = build(false, args);
      const viaManifest = build(true, args);
      expect(viaManifest).toBe(hand);
    });
  }

  test("the comparison is not vacuous: every input really is in the prompt, in order", () => {
    process.env.VOICE_HOUSE_CONTEXT = "1";
    const out = build(true, CASES.everything);
    const at = ["19°, clear", "coldest morning", "At the door", "about 17:30"].map((s) => out.indexOf(s));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test("house context off: the manifest contributes nothing either", () => {
    const hand = build(false, CASES.everything);
    const viaManifest = build(true, CASES.everything);
    expect(viaManifest).toBe(hand);
    expect(viaManifest).not.toContain("19°, clear");
  });

  test("converseReads renders only read rows that carry a renderer", () => {
    const out = converseReads({ digest: DIGEST, claims: CLAIMS, houseClaims: HOUSE_CLAIMS, today: TODAY });
    expect(out).toHaveLength(4);   // unresolved has nothing open in this fixture
    expect(out.join("\n")).not.toMatch(/set_light|planCall/);
  });
});
