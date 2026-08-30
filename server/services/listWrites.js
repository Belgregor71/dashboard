/* ═══════════════════════════════════════════════════════════════════════════
   LIST WRITES — the first honest write in this repo.

   docs/AUGUST-IMPROVEMENTS.md §3. Every other write endpoint in the tree is
   about the dashboard's own state: photo vetoes, memories, recipes, routines,
   census, delight. Not one is about the household's. So the wall knows the
   shopping list and cannot add oat milk to it, and a phone comes out in front
   of a screen that already had the answer.

   ⚠⚠ WHY THIS IS NOT A PROXY. `runToolCall` (routes/voice.js) reports "done"
   from a `haPost` that did not throw, and on that basis the house said
   "backyard light's on now" while four of five floodlights ignored the call
   entirely (docs/BACKLOG.md:722-729). A non-throwing write is not a write that
   happened. So every operation here is write → RE-READ THE LIST → judge, and
   the sentence the wall speaks is built from the re-read.

   This module is pure on purpose: no fetch, no env, no clock. The route feeds
   it what it observed and it decides what that means, so every branch —
   including the ones that need a broken Home Assistant to reach — is a table
   in tests/list-writes.spec.js.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ⚠ THE ENTITY ID NEVER COMES FROM THE REQUEST. The client sends a key and the
   server resolves it here, which is `planCall`'s rule (services/voiceTools.js):
   the roster is the bound, and the body is re-validated even when the caller
   already validated it. Deliberately NOT the house's four todo entities — a
   mishearing must not be able to write into a named person's private list, so
   todo.greg and todo.brett are unreachable from this lane by construction. */
export const WRITABLE_LISTS = Object.freeze({
  shopping: { entityId: "todo.shopping_list", label: "shopping list" },
  household: { entityId: "todo.both", label: "house list" }
});

export const LIST_VERBS = Object.freeze(["add", "complete", "remove"]);

export function resolveList(key) {
  return Object.hasOwn(WRITABLE_LISTS, String(key ?? "")) ? WRITABLE_LISTS[key] : null;
}

/* ── The readback shape ─────────────────────────────────────────────────────
   Measured against the live house 2026-08-30. HA's REST service call with
   ?return_response=true answers:

     { "changed_states": [], "service_response": { "<entity>": { "items": [...] } } }

   ⚠⚠ RETURNS null, NOT [], FOR A SHAPE IT CANNOT READ. A payload we failed to
   parse is not a list with nothing on it. The client-side twin of this function
   (services/homeAssistant/client.js) flattened both to [] and had the
   `service_response` spelling missing besides, which is why the wall reported
   every to-do list as empty regardless of what was on it. `decideOutcome`
   turns a null here into "unknown", never into "it did not take". */
export function extractItems(payload, entityId) {
  if (Array.isArray(payload)) return payload;
  const keyed = payload?.service_response ?? payload?.response ?? payload;
  const items = keyed?.[entityId]?.items ?? keyed?.items;
  return Array.isArray(items) ? items : null;
}

/* HA's todo integrations disagree about the item shape — the same disagreement
   services/homeAssistant/todoEntities.js documents for the browser half. */
export function summaryOf(item) {
  return String(item?.summary || item?.name || item?.title || "").trim();
}

export function isCompleted(item) {
  if (item?.complete === true) return true;
  return String(item?.status || "").toLowerCase() === "completed";
}

export function openItems(items) {
  return (items ?? []).filter((item) => !isCompleted(item));
}

const norm = (text) => String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Find the item a spoken phrase meant. Exact (case-insensitive) first, and only
 * then a substring — "bread" should reach "Sourdough bread", but if two items
 * both contain it the house has no way to choose and must not guess.
 *
 * @returns {{item: object}|{ambiguous: string[]}|null}
 */
export function findItem(items, wanted) {
  const want = norm(wanted);
  if (!want) return null;

  const pool = items ?? [];
  const exact = pool.filter((item) => norm(summaryOf(item)) === want);
  if (exact.length) return { item: exact[0] };

  const partial = pool.filter((item) => norm(summaryOf(item)).includes(want));
  if (partial.length === 1) return { item: partial[0] };
  if (partial.length > 1) return { ambiguous: partial.map(summaryOf) };
  return null;
}

/**
 * What did the re-read prove?
 *
 * @param {object} o
 * @param {"add"|"complete"|"remove"} o.verb
 * @param {string} o.item        what the room asked for
 * @param {boolean} o.wrote      the service call returned without throwing
 * @param {boolean} o.fetchOk    the re-read returned a payload we could parse
 * @param {Array|null} o.itemsAfter  every item on the list after the write
 * @returns {{ok: boolean, state: string, count: number|null, items: string[]}}
 *
 * `state` is one of:
 *   confirmed   — the re-read agrees the change happened
 *   not-on-list — the write reported success and the list disagrees. THIS IS
 *                 THE CASE THE WHOLE MODULE EXISTS FOR: a no-op success walks
 *                 straight past a "never pretend you did it" rule written for
 *                 refusals.
 *   unknown     — we could not write, or could not read back. NOT a failure to
 *                 change anything; a failure to find out. The wall must say so.
 */
export function decideOutcome({ verb, item, wrote, fetchOk, itemsAfter }) {
  const blind = { ok: false, state: "unknown", count: null, items: [] };
  if (!wrote || !fetchOk || !Array.isArray(itemsAfter)) return blind;

  const open = openItems(itemsAfter);
  const summaries = open.map(summaryOf);
  const count = open.length;

  // "add" and "complete" are judged against the OPEN items — an item ticked off
  // is still on the list, and re-adding something already completed must read
  // as present rather than as a silent no-op. "remove" is judged against every
  // item, because a removal that only completed the item did not remove it.
  const pool = verb === "remove" ? itemsAfter : open;
  const present = Boolean(findItem(pool, item)?.item);
  const wanted = verb === "add" ? present : !present;

  return {
    ok: wanted,
    state: wanted ? "confirmed" : "not-on-list",
    count,
    items: summaries
  };
}

/* The reverse of each write, for the undo the destructive two require. Speech
   misfires — that is not a hypothesis, it is why the photograph veto shipped
   with "bring that back" (project-photo-veto). A removal spoken at a wall with
   no pointer and no undo is a list item nobody can recover. */
export const INVERSE_VERB = Object.freeze({
  add: "remove",
  remove: "add",
  complete: "uncomplete"
});
