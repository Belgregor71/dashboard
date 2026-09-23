import { test, expect } from "@playwright/test";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SRC, rel, rawOf, codeOf, moduleEntry, importClosure } from "./fixtures/source-scan.js";
import { EVENTS, RELAYS } from "./fixtures/event-registry.js";

/* ═══════════════════════════════════════════════════════════════════════════
   WHICH BUS EVENTS ARE HEARD — HOUSE-MIND S1, 2026-09-23.

   An event with no listener fails silently. S0 found four dead ones on V3 by
   reading, and nothing in the suite had noticed any of them. So the declared
   table in tests/fixtures/event-registry.js is checked against the source,
   and this spec goes red on:

     1. the scan sees what it claims to see  → a blind scan passes everything
     2. every bus call form is one it knows  → a computed event name or a new
                                               wrapper, which the scan would
                                               otherwise skip
     3. the table names exactly the events   → an undeclared event, or a stale
        the source uses                        row for one that is gone
     4. each row's publishers and consumers  → a moved emit, or a consumer that
        are the ones in the source             quietly lost its publisher
     5. no event is orphaned on either       → "published, never heard" or
        surface without a declared reason      "heard, never published" — the
                                               arrival:home / intent:changed class
     6. every declared orphan is still one   → an excuse that outlived its cause

   ⚠ A red 5 is not a row to add until green — see the registry's header.
   ═══════════════════════════════════════════════════════════════════════════ */

const BUS = join(SRC, "js", "core", "eventBus.js");
const BUS_FNS = ["on", "emit", "off"];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(m|c)?js$/.test(e.name)) out.push(p);
  }
  return out;
}

const esc = (s) => s.replace(/[$]/g, "\\$");

/* The bus names a file imports, with their local aliases (main.js imports
   `emit as emitBus`). */
function busImports(code) {
  const names = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\/eventBus\.js["']/g;
  let m;
  while ((m = re.exec(code))) {
    for (const part of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      const [orig, local] = part.split(/\s+as\s+/).map((s) => s.trim());
      names.push({ orig, local: local || orig });
    }
  }
  return names;
}

function scan() {
  const files = walk(SRC).filter((f) => f !== BUS);
  const events = new Map();
  const touch = (name) => {
    if (!events.has(name)) events.set(name, { publishers: new Set(), consumers: new Set() });
    return events.get(name);
  };
  const busFiles = [];
  const unknownForms = [];
  const relayHits = [];

  for (const f of files) {
    const code = codeOf(f);
    const file = rel(f);
    // Any mention of the bus module in code must be the named-import form.
    const mentions = (code.match(/eventBus\.js/g) || []).length;
    const imports = busImports(code);
    const namedImportCount = (
      code.match(/import\s*\{[^}]*\}\s*from\s*["'][^"']*\/eventBus\.js["']/g) || []
    ).length;
    if (mentions !== namedImportCount) {
      unknownForms.push(`${file}: reaches eventBus.js other than by \`import { … } from\``);
    }
    if (!imports.length) continue;
    busFiles.push(file);

    const relay = RELAYS.find((r) => r.file === file);
    for (const { orig, local } of imports) {
      if (!BUS_FNS.includes(orig)) {
        unknownForms.push(`${file}: imports \`${orig}\` from the bus`);
        continue;
      }
      const call = new RegExp(`(?<![.\\w$])${esc(local)}\\(\\s*([^\\s)])`, "g");
      let m;
      while ((m = call.exec(code))) {
        const at = m.index + m[0].length - 1;
        const lit = code.slice(at).match(/^(["'`])([^"'`$]+)\1/);
        if (!lit) {
          const tail = code.slice(at, at + 40).split("\n")[0];
          if (relay && orig === "emit" && tail.startsWith(`${relay.param},`)) {
            relayHits.push(file);
            continue;
          }
          unknownForms.push(`${file}: ${local}(${tail}`);
          continue;
        }
        if (orig === "off") continue;
        const row = touch(lit[2]);
        (orig === "emit" ? row.publishers : row.consumers).add(file);
      }
    }
    if (relay) {
      const call = new RegExp(`(?<![.\\w$])${esc(relay.fn)}\\(\\s*(["'])([^"']+)\\1`, "g");
      let m;
      while ((m = call.exec(code))) touch(m[2]).publishers.add(file);
    }
  }

  const v3Entry = moduleEntry("v3/index.html");
  const incEntry = moduleEntry("index.html");
  const v3 = new Set([...importClosure(v3Entry, codeOf)].map(rel));
  const inc = new Set([...importClosure(incEntry, codeOf)].map(rel));
  return { files, busFiles, events, unknownForms, relayHits, v3Entry, incEntry, v3, inc };
}

/* Within one surface's closure: published-and-unheard, or heard-and-unpublished. */
function orphansOn(s, closure) {
  const out = new Map();
  for (const [name, row] of s.events) {
    const pub = [...row.publishers].some((f) => closure.has(f));
    const sub = [...row.consumers].some((f) => closure.has(f));
    if (pub && !sub) out.set(name, "unheard");
    if (sub && !pub) out.set(name, "unpublished");
  }
  return out;
}

const SURFACES = [
  { key: "orphanOnV3", label: "V3 (the wall)", closure: (s) => s.v3 },
  { key: "orphanOnIncumbent", label: "the incumbent", closure: (s) => s.inc }
];

test.describe("event registry — every bus event is heard (HOUSE-MIND S1)", () => {
  test("the scan sees the bus, both closures and events on both sides", () => {
    const s = scan();
    /* Assert the nodes are there before asserting anything about them: an
       empty event map or closure makes 3–6 vacuous rather than red. */
    expect(s.v3Entry && existsSync(s.v3Entry), "src/v3/index.html has no module entry").toBe(true);
    expect(s.incEntry && existsSync(s.incEntry), "src/index.html has no module entry").toBe(true);
    expect(rel(s.v3Entry)).toBe("src/v3/main.js");
    expect(s.busFiles.length).toBeGreaterThan(30);
    expect(s.events.size).toBeGreaterThan(15);
    expect(s.v3.has("src/js/core/eventBus.js")).toBe(true);
    expect(s.v3.has("src/js/core/app.js")).toBe(false);

    // Known edges, including the alias (emitBus) and the relay (record).
    const pubs = (n) => [...(s.events.get(n)?.publishers ?? [])];
    const subs = (n) => [...(s.events.get(n)?.consumers ?? [])];
    expect(pubs("ha:states")).toContain("src/js/services/homeAssistant/client.js");
    expect(subs("ha:states")).toContain("src/js/services/homeAssistant/entityFeed.js");
    expect(pubs("sound:presence"), "the `emit as emitBus` alias in main.js").toContain("src/v3/main.js");
    expect(pubs("command:executed"), "commands.js's record() relay").toContain("src/v3/core/commands.js");
    expect(s.relayHits, "the relay's own `emit(event, …)` was not found").toEqual(["src/v3/core/commands.js"]);

    /* The stripper self-check, as in flag-surface: stripping must not eat an
       import edge, or an emit on the same stretch would vanish with it. */
    const raw = [...importClosure(s.v3Entry, rawOf)].map(rel).sort();
    expect([...s.v3].sort(), "stripping comments changed V3's import closure").toEqual(raw);
  });

  test("every bus call names its event as a literal (or goes through a declared relay)", () => {
    expect(
      scan().unknownForms,
      "A bus call this scan cannot read. A computed event name or a new wrapper " +
        "would be skipped by every check below — make the name a literal, or " +
        "declare the wrapper in RELAYS (tests/fixtures/event-registry.js)."
    ).toEqual([]);
  });

  test("the registry names exactly the events the source uses", () => {
    const derived = [...scan().events.keys()].sort();
    const declared = Object.keys(EVENTS).sort();
    expect(
      derived.filter((n) => !declared.includes(n)),
      "Events on the bus with no row in tests/fixtures/event-registry.js"
    ).toEqual([]);
    expect(
      declared.filter((n) => !derived.includes(n)),
      "Registry rows for events nothing publishes or hears any more — delete them"
    ).toEqual([]);
  });

  test("each row's publishers and consumers are the ones in the source", () => {
    const s = scan();
    const drift = [];
    for (const [name, row] of Object.entries(EVENTS)) {
      const got = s.events.get(name);
      if (!got) continue; // reported by the test above
      for (const side of ["publishers", "consumers"]) {
        const want = [...row[side]].sort();
        const have = [...got[side]].sort();
        if (JSON.stringify(want) !== JSON.stringify(have)) {
          drift.push(`${name}.${side}: declared ${JSON.stringify(want)} · source ${JSON.stringify(have)}`);
        }
      }
    }
    expect(drift, "Registry rows that no longer match the source").toEqual([]);
  });

  for (const surface of SURFACES) {
    test(`no event is orphaned on ${surface.label} without a declared reason`, () => {
      const s = scan();
      const undeclared = [];
      for (const [name, kind] of orphansOn(s, surface.closure(s))) {
        const excuse = EVENTS[name]?.[surface.key];
        if (!excuse || excuse.kind !== kind) {
          const row = s.events.get(name);
          undeclared.push(
            `${name}: ${kind === "unheard" ? "PUBLISHED, NEVER HEARD" : "HEARD, NEVER PUBLISHED"} ` +
              `(pub: ${[...row.publishers].join(", ") || "none"} · sub: ${[...row.consumers].join(", ") || "none"})`
          );
        }
      }
      expect(
        undeclared,
        `Dead wiring on ${surface.label}. Within its import closure these events ` +
          `have a publisher and no listener, or a listener and no publisher. That is ` +
          `a lever that silently does nothing — read the change that caused it before ` +
          `declaring an orphan in the registry.`
      ).toEqual([]);
    });

    test(`every declared orphan on ${surface.label} is still one`, () => {
      const s = scan();
      const live = orphansOn(s, surface.closure(s));
      const stale = Object.entries(EVENTS)
        .filter(([, row]) => row[surface.key])
        .filter(([name, row]) => live.get(name) !== row[surface.key].kind)
        .map(([name, row]) => `${name}: declared ${row[surface.key].kind}, source says ${live.get(name) ?? "wired"}`);
      expect(stale, "Orphan excuses that outlived their cause — remove them").toEqual([]);
    });
  }
});
