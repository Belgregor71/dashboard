/* ─────────────────────────────────────────────────────────────────────────────
   THE DOG SHOW — "show me the dogs" (features.v3DogVoice).

   Every look of today's occasion, one after another: look i for Benji with
   look i for Teddy (the shorter list wraps), a short breath between, and a run
   to finish when the occasion has one (Christmas). A named dog plays only his
   own looks. It is the wall demo, asked for out loud.

   Everything it touches is injected (`show`, `sleep`), so a spec can walk the
   whole programme in microseconds; the voice lane passes dogOccasion.show.

   A new ask while a show is running replaces it: the running programme sees
   its token go stale and stops at the next gap, and the dogs on the glass are
   taken off by the caller's hide(). A performance that does not reach the glass
   ({ shown: false } — hidden, busy) ends the programme there rather than
   pressing on against whatever took the glass.
   ───────────────────────────────────────────────────────────────────────────── */

export const GAP_MS = 1200;
export const DOG_IDS = ["benji", "teddy"];

let token = 0;

/**
 * The programme, as data: { occasion, steps: [{ mode, looks }] } where looks is
 * { id → index }. `occasions` is dog-occasion's OCCASIONS; an occasion with no
 * peek (or none at all) plays the generic show, and `occasion` says which.
 */
export function programmeFor(occasions, occasionId, dogs = DOG_IDS) {
  const occasion = occasions[occasionId]?.peek ? occasionId : "generic";
  const staged = occasions[occasion];
  const peek = staged.peek;
  const ids = dogs.filter((id) => peek.dogs[id]?.length);
  if (!ids.length) return { occasion, steps: [] };
  const n = Math.max(...ids.map((id) => peek.dogs[id].length));
  const steps = [];
  for (let i = 0; i < n; i++) {
    steps.push({ mode: "peek", looks: Object.fromEntries(ids.map((id) => [id, i % peek.dogs[id].length])) });
  }
  const run = staged.run;
  const runners = ids.filter((id) => run?.dogs[id]?.length);
  if (runners.length) steps.push({ mode: "run", looks: Object.fromEntries(runners.map((id) => [id, 0])) });
  return { occasion, steps };
}

/**
 * Play a programmeFor() result. Resolves { played, of, stopped? } when it
 * ends — never throws, never rejects.
 */
export async function playDogShow({ occasion, steps, show, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const mine = ++token;
  let played = 0;
  for (const [i, step] of steps.entries()) {
    if (i > 0) await sleep(GAP_MS);
    // After the breath: a new ask during the gap, or during the last step.
    if (mine !== token) return { played, of: steps.length, stopped: "replaced" };
    let r;
    try {
      r = await show(occasion, { mode: step.mode, dogs: Object.keys(step.looks), looks: step.looks });
    } catch {
      r = { shown: false, reason: "threw" };
    }
    if (!r?.shown) return { played, of: steps.length, stopped: r?.reason ?? "not-shown" };
    played += 1;
  }
  return { played, of: steps.length };
}

/** Stop a running programme at its next step (the caller hides the dogs). */
export function stopDogShow() {
  token += 1;
}
