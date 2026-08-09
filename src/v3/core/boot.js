/* ═══════════════════════════════════════════════════════════════════════════
   BOOT ISOLATION — one subsystem's throw must not take the wall with it.

   Cutover step 4 (docs/design/V3-CUTOVER.md §4). `boot()` in main.js is the
   densest node in the whole graph: 44 edges, every subsystem initialising
   through it, in one flat sequence of statements. A throw anywhere in that
   sequence ends it — so today a bad `initGround()` costs you the substrate,
   the timers, the depth machinery and every debug handle after it.

   While V3 was the secondary surface that degraded a page nobody was looking
   at. Once `/` serves V3 there is nothing behind it. A wall that is black
   because line nine threw is indistinguishable from a wall that is off.

   ── The three rules ─────────────────────────────────────────────────────────

   1. **Stages continue.** Each `init*()` runs inside `stage()`; a throw is
      caught, recorded and the next stage runs. `boot()` itself can no longer
      throw, which also keeps it out of the uncaught-page-error class the
      Playwright suite exists to catch.

   2. **The FIRST failure is the cause.** Boot is ordered, so a later stage
      failing is usually a consequence of an earlier one — the attention queue
      cannot be blamed for a feed that never registered. Naming one cause and
      staying quiet about its symptoms is health.js's rule, and this is the
      same rule applied to the boot sequence rather than to the server's feeds.

   3. **The failure is visible in the room, not just in the console.** A
      console nobody reads is the same as no report. `bootFault()` is consumed
      by `core/health.js` — the one-line notice into the attention queue — and
      by `subjects/status.js`, the readout you can ask for out loud. Both
      already existed; this adds no new writer of any cell.

   ── Timers get the same treatment ───────────────────────────────────────────

   `guard()` wraps the interval callbacks. `setInterval` keeps firing after its
   callback throws, so a broken `pushCauses` is not a stopped clock — it is an
   uncaught error every sixty seconds, forever, on a page that runs for weeks.
   The first is logged and the rest are counted: forty thousand identical lines
   a month would bury the one line that mattered.

   ⚠ A repeating callback only becomes a FAULT after TICK_FAULT_AFTER failures.
   A single throw is a blip — a null from a feed, a resize mid-frame — and a
   wall that announces blips teaches the room to ignore it before anything is
   actually broken. Three consecutive minutes of the same subsystem failing is
   not a blip.

   ── The __boom seam ─────────────────────────────────────────────────────────

   `/v3/?__boom=ground,substrate` makes those stages throw on purpose. It is
   the only way to verify this from outside: isolation is a property you can
   only see by breaking something, and "the wall still paints when a subsystem
   is dead" cannot be checked by reading the code. It works on the kiosk over
   CDP as well as in a spec, which is the point — this project does not call a
   fix done until it has been seen on the glass.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Three, and it is a threshold rather than a switch for the reason above. Also
   the smallest number that cannot be a coincidence: two could be one cause
   firing twice inside a single bad minute. */
const TICK_FAULT_AFTER = 3;

/* In boot order. A late async rejection appends, which is why bootFault()
   takes the FIRST failure and not the loudest — a stage that failed after the
   sequence finished cannot be upstream of one that failed during it. */
const stages = [];        // { name, ok, error? }
const ticks = new Map();  // name -> { failures, error }

let boom = null;

/* Parsed once, lazily: `location` does not exist when this module is imported
   by a Node-side spec, and a module that throws at import time inside the boot
   isolator would be a joke with a long setup. */
function boomed(name) {
  if (boom === null) {
    boom = new Set();
    try {
      const raw = new URLSearchParams(globalThis.location?.search ?? "").get("__boom");
      for (const part of (raw ?? "").split(",")) {
        const trimmed = part.trim();
        if (trimmed) boom.add(trimmed);
      }
    } catch { /* no location, or a search string URLSearchParams refuses */ }
  }
  return boom.has(name);
}

function fail(name, error) {
  stages.push({ name, ok: false, error: String(error?.message ?? error) });
  console.error(`[v3] boot stage "${name}" failed — the rest of the wall carries on without it.`, error);
}

/**
 * Run one boot stage. Records it, catches it, returns whatever it returned —
 * or `undefined` if it threw, so callers can keep using the value.
 *
 * ⚠ Shaped for synchronous work. If `fn` hands back a thenable, a rejection is
 * recorded as a LATE failure (appended after everything that ran during boot)
 * rather than being left to become an unhandled rejection.
 */
export function stage(name, fn) {
  /* ⚠ The injected fault THROWS FROM INSIDE THE TRY rather than short-circuiting
     around it, and that is not a detail. A seam that returns early instead
     records the same report while never touching the catch — so every spec
     driving `?__boom=` would pass against a stage() with no try/catch at all,
     which is the one defect they exist to see. Measured: it did, three of them,
     before this line looked like this. A fixture that cannot produce the defect
     cannot catch it. */
  const body = boomed(name)
    ? () => { throw new Error(`__boom=${name} — deliberate fault injection`); }
    : fn;

  try {
    const value = body();
    stages.push({ name, ok: true });
    if (value && typeof value.then === "function") {
      value.then(undefined, (error) => fail(name, error));
    }
    return value;
  } catch (error) {
    fail(name, error);
    return undefined;
  }
}

/**
 * Wrap a repeating callback so its throw stays inside it.
 * @returns {Function} the guarded callback, for `setInterval` and friends.
 */
export function guard(name, fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      const entry = ticks.get(name) ?? { failures: 0, error: null };
      entry.failures += 1;
      entry.error = String(error?.message ?? error);
      ticks.set(name, entry);
      if (entry.failures === 1) {
        console.error(`[v3] "${name}" threw — it will be counted, not re-logged.`, error);
      }
      return undefined;
    }
  };
}

/** Plain words for what is broken. The room-facing sentence is deliberately
 *  generic; the stage names go in `detail`, where the status readout shows
 *  them and the one-line notice does not. "substrate" is not a word anyone in
 *  a kitchen should have to hear to know the screen is unwell. */
function detailFor(dead, repeating) {
  const parts = [];
  if (dead.length === 1) parts.push(`${dead[0]} didn't start`);
  else if (dead.length > 1) parts.push(`${dead.length} parts didn't start: ${dead.join(", ")}`);
  if (repeating.length === 1) parts.push(`${repeating[0]} keeps failing`);
  else if (repeating.length > 1) parts.push(`${repeating.length} parts keep failing: ${repeating.join(", ")}`);
  return parts.join(" · ");
}

/**
 * The surface's own fault, in the shape `worstFault()` returns, or null.
 *
 * ⚠ This outranks every server feed, and that is not self-importance. The
 * feeds describe things the surface is REPORTING on; this describes whether
 * the surface is in a fit state to report at all. A wall that half-booted and
 * then tells you the calendar is late is answering the wrong question.
 */
export function bootFault() {
  const dead = stages.filter((s) => !s.ok).map((s) => s.name);
  const repeating = [...ticks].filter(([, t]) => t.failures >= TICK_FAULT_AFTER).map(([name]) => name);
  if (dead.length === 0 && repeating.length === 0) return null;

  return {
    id: "surface",
    // One cause: the earliest thing that broke, which is the only one that
    // could not have been caused by something else on this list.
    cause: dead[0] ?? repeating[0],
    detail: detailFor(dead, repeating),
    text: "Part of the screen didn't start."
  };
}

/** Everything, for `__v3()` and `__v3Boot()` — the question you ask a wall
 *  that came up wrong. */
export function bootReport() {
  return {
    stages: stages.map((s) => ({ ...s })),
    failed: stages.filter((s) => !s.ok).map((s) => s.name),
    ticks: [...ticks].map(([name, t]) => ({ name, failures: t.failures, error: t.error })),
    fault: bootFault()
  };
}

/** Test seam — a spec that asserts on a clean boot must be able to start from
 *  one, including the parsed __boom set. */
export function __resetBoot() {
  stages.length = 0;
  ticks.clear();
  boom = null;
}
