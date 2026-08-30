import express from "express";

import { loopbackOnly } from "../middleware/security.js";
import { readHaConfig } from "../ha/haConfig.js";
import { haPost } from "../ha/haRest.js";
import {
  WRITABLE_LISTS,
  INVERSE_VERB,
  resolveList,
  extractItems,
  findItem,
  isCompleted,
  openItems,
  summaryOf,
  decideOutcome
} from "../services/listWrites.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE LIST WRITE LANE — docs/AUGUST-IMPROVEMENTS.md §3.

   Write, re-read, then judge. The judging is in services/listWrites.js and is
   pure; this file is the part that talks to Home Assistant and holds the one
   slot of undo memory.

   ⚠ TWO KEYS, deliberately, the same shape as VOICE_TOOLS_ENABLED: the browser
   flag `voiceListWrites` decides whether the utterance is ever matched, and
   VOICE_LIST_WRITES=1 on the box decides whether the house may be changed at
   all. Either one off is a full stop, and unsetting the env var is a rollback
   that needs a restart and no redeploy.

   ⚠ LOOPBACK ONLY. This is the one lane in the repo that changes something
   outside the dashboard; the kiosk browser is on the box, so nothing legitimate
   reaches it from the LAN. When the remote surface of §2 arrives it can be let
   in deliberately, rather than having been reachable all along by omission.
   ═══════════════════════════════════════════════════════════════════════════ */

const router = express.Router();

const MAX_ITEM_LENGTH = 120;

/* How long to keep re-reading before calling a write missing. The tool lane
   learned this the expensive way: HA reports the entities that changed
   SYNCHRONOUSLY, and a Eufy switch that worked perfectly returned [] and came
   on seconds later (project-voice-tool-lane). A local todo write should land on
   the first read, which is exactly why this is a small bounded ladder and not a
   retry loop — a lane that waits is a lane that will one day wait forever. */
const READBACK_DELAYS_MS = [0, 400, 900];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const writesEnabled = () => process.env.VOICE_LIST_WRITES === "1";

function callTodo(service, body) {
  return haPost(`/api/services/todo/${service}`, body);
}

async function readItems(entityId) {
  try {
    const payload = await haPost("/api/services/todo/get_items?return_response=true", {
      entity_id: entityId
    });
    return extractItems(payload, entityId);
  } catch {
    return null;
  }
}

/* Write already done; now find out whether it is true. Stops the moment the
   list agrees, so the common case costs exactly one read. */
async function confirm({ entityId, verb, item }) {
  let last = { ok: false, state: "unknown", count: null, items: [] };

  for (const wait of READBACK_DELAYS_MS) {
    if (wait) await delay(wait);
    const itemsAfter = await readItems(entityId);
    last = decideOutcome({
      verb,
      item,
      wrote: true,
      fetchOk: Array.isArray(itemsAfter),
      itemsAfter
    });
    if (last.state === "confirmed") return last;
  }

  return last;
}

/* One slot, this process only. Not persisted on purpose: an undo that survives
   a restart is an undo nobody remembers asking for, and the phrase that reaches
   it ("put that back") is only ever said in the same breath as the mistake. */
let lastWrite = null;

function readItemText(req) {
  const raw = req.body?.item;
  if (typeof raw !== "string") return null;
  const item = raw.trim().replace(/\s+/g, " ");
  if (!item || item.length > MAX_ITEM_LENGTH) return null;
  return item;
}

/**
 * Every write goes through here: resolve the list, resolve the item the room
 * actually meant, call the service, then re-read and let listWrites.js judge.
 *
 * `verb` is the caller's intent; `service`/`body` are derived from it. The
 * exact stored summary — not the phrase that was spoken — is what gets written
 * and what gets remembered for the undo.
 */
async function applyWrite({ listKey, verb, spokenItem, remember = true }) {
  const list = resolveList(listKey);
  if (!list) return { status: 400, body: { error: `unknown list: ${listKey}` } };

  const base = { list: listKey, label: list.label, item: spokenItem };

  // add is the only verb that does not need to find something first.
  let target = spokenItem;
  if (verb !== "add") {
    const items = await readItems(list.entityId);
    if (!Array.isArray(items)) {
      return { status: 200, body: { ...base, ok: false, state: "unknown", count: null, items: [] } };
    }
    /* Which items can this verb legitimately act on? "remove" may take any of
       them; "complete" must find one still OPEN, or a second "we got the milk"
       would call update_item on an already-ticked item, get a cheerful 200 and
       report a change that did not happen — the exact shape of the floodlight
       bug. "uncomplete" is the mirror and looks only at the ticked ones. */
    const pool =
      verb === "remove" ? items
      : verb === "uncomplete" ? items.filter(isCompleted)
      : openItems(items);
    const found = findItem(pool, spokenItem);
    if (!found) {
      return {
        status: 200,
        body: { ...base, ok: false, state: "no-such-item", count: null, items: items.map(summaryOf) }
      };
    }
    if (found.ambiguous) {
      return {
        status: 200,
        body: { ...base, ok: false, state: "ambiguous", count: null, items: found.ambiguous }
      };
    }
    target = summaryOf(found.item);
  }

  const call = {
    add: ["add_item", { item: target }],
    remove: ["remove_item", { item: target }],
    complete: ["update_item", { item: target, status: "completed" }],
    uncomplete: ["update_item", { item: target, status: "needs_action" }]
  }[verb];

  try {
    await callTodo(call[0], { entity_id: list.entityId, ...call[1] });
  } catch {
    // ⚠ The write itself failed, so nothing changed and we know it. That is a
    // different sentence from "we could not find out", and both are honest.
    return { status: 200, body: { ...base, ok: false, state: "unknown", count: null, items: [] } };
  }

  // uncomplete is judged the way add is: the item must be back among the open.
  const outcome = await confirm({
    entityId: list.entityId,
    verb: verb === "uncomplete" ? "add" : verb,
    item: target
  });

  if (remember && outcome.ok) lastWrite = { listKey, verb, item: target, at: Date.now() };
  if (!remember) lastWrite = null;

  return { status: 200, body: { ...base, item: target, ...outcome } };
}

function guard(req, res) {
  if (!writesEnabled()) {
    res.status(403).json({ error: "list writes are not enabled" });
    return false;
  }
  if (!readHaConfig({ requireConfig: false }).enabled) {
    res.status(503).json({ error: "Home Assistant integration is disabled" });
    return false;
  }
  return true;
}

async function handle(req, res, verb) {
  if (!guard(req, res)) return;
  const item = readItemText(req);
  if (!item) {
    res.status(400).json({ error: `expected { item: string } of 1-${MAX_ITEM_LENGTH} characters` });
    return;
  }
  const { status, body } = await applyWrite({ listKey: req.params.list, verb, spokenItem: item });
  res.status(status).json(body);
}

router.get("/api/lists", loopbackOnly("The list lane"), (_req, res) => {
  res.json({
    enabled: writesEnabled(),
    lists: Object.fromEntries(
      Object.entries(WRITABLE_LISTS).map(([key, { label }]) => [key, { label }])
    ),
    undoable: lastWrite ? { list: lastWrite.listKey, verb: lastWrite.verb, item: lastWrite.item } : null
  });
});

router.post("/api/lists/:list/items", loopbackOnly("The list lane"), (req, res) =>
  handle(req, res, "add")
);

router.post("/api/lists/:list/items/complete", loopbackOnly("The list lane"), (req, res) =>
  handle(req, res, "complete")
);

router.delete("/api/lists/:list/items", loopbackOnly("The list lane"), (req, res) =>
  handle(req, res, "remove")
);

router.post("/api/lists/undo", loopbackOnly("The list lane"), async (req, res) => {
  if (!guard(req, res)) return;
  if (!lastWrite) {
    // Nothing to undo is not an error, and it must not SOUND like one — the
    // caller falls through and says nothing rather than inventing a reversal.
    res.json({ ok: false, state: "nothing-to-undo", count: null, items: [] });
    return;
  }

  const { listKey, verb, item } = lastWrite;
  const { status, body } = await applyWrite({
    listKey,
    verb: INVERSE_VERB[verb],
    spokenItem: item,
    remember: false
  });
  res.status(status).json({ ...body, undone: verb });
});

/** Test seam: the undo slot is process state, and a spec that leaves it armed
 *  changes the next spec's answer. Never called by the surfaces. */
export function __resetListWrites() {
  lastWrite = null;
}

export default router;
