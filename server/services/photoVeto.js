/* ═══════════════════════════════════════════════════════════════════════════
   PHOTO VETO — the room's own judgement, kept.

   Nothing in the Immich library records whether a photograph is worth looking
   at. Measured 2026-08-14 across 494 assets: favourites 0.2%, star ratings 0%,
   duplicate detection never run. And the obvious proxy does not work either —
   a variance-of-Laplacian sweep ranked the photograph the owner objected to
   20th of 118, while the softest end of the distribution was almost entirely
   legitimate night photographs. A sharpness filter here is a night-photo
   filter wearing a disguise, which is how two earlier filters were rejected.

   So this does not guess. The house asks nobody to rate anything; it just
   remembers the one thing the room ever says out loud — "not this one" — and
   never shows that photograph again. Curation as a by-product of living with
   the wall, rather than an afternoon spent in a photo manager.

   ⚠ THE LIST IS THE ONLY STATE, and it starts empty, so an install that never
   vetoes anything behaves exactly as before — that is what makes the client's
   feature flag a complete rollback. Filtering is unconditional on this side
   BECAUSE an empty list filters nothing; gating it twice would mean a flag-off
   client could still be served a list a flag-on one had written.
   ═══════════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "..", "data", "photos");
const FILE = path.join(DIR, "hidden.json");

/* An upper bound, because this file is written by a voice command on a wall
   that runs for years. At 36 bytes an id this is ~180 KB, and a library big
   enough to veto 5000 photographs from has a different problem. Oldest go
   first: a veto from three years ago has already done its work. */
const MAX_HIDDEN = 5000;

/** @type {{ ids: string[], last: string[] } | null} */
let state = null;

/* Lazy, and deliberately synchronous: it is one small file, read at most once
   per process, and every caller (usableImage) is synchronous and on the hot
   path for every photograph the wall ever shows. Loading it asynchronously
   would mean the first search after boot silently skips the filter. */
function load() {
  if (state) return state;
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    state = {
      ids: Array.isArray(raw?.ids) ? raw.ids.filter((id) => typeof id === "string") : [],
      last: Array.isArray(raw?.last) ? raw.last.filter((id) => typeof id === "string") : []
    };
  } catch {
    // No file, unreadable file, malformed file: an empty list is the correct
    // and safe reading. A veto list that fails to load must never fail CLOSED
    // and blank the wall.
    state = { ids: [], last: [] };
  }
  return state;
}

function persist() {
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(state, null, 2));
    return true;
  } catch {
    /* The wall keeps working on the in-memory list; it just forgets at the next
       restart. Losing a veto is a far smaller failure than a 500 into a voice
       turn, so this is reported, not thrown. */
    return false;
  }
}

/** Is this asset one the room has already said no to? */
export function isHidden(id) {
  return typeof id === "string" && load().ids.includes(id);
}

/** Every hidden id, newest last. */
export function hiddenIds() {
  return [...load().ids];
}

/**
 * Hide one frame's worth of photographs — a single, or both halves of a
 * diptych. Recorded as ONE act so that undo restores the frame the room was
 * actually looking at, rather than half of it.
 *
 * @returns {{ hidden: string[], total: number, persisted: boolean }}
 */
export function hide(ids) {
  const s = load();
  const fresh = (Array.isArray(ids) ? ids : [ids])
    .filter((id) => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id))
    .filter((id) => !s.ids.includes(id));

  if (!fresh.length) return { hidden: [], total: s.ids.length, persisted: true };

  s.ids.push(...fresh);
  if (s.ids.length > MAX_HIDDEN) s.ids = s.ids.slice(s.ids.length - MAX_HIDDEN);
  s.last = fresh;
  return { hidden: fresh, total: s.ids.length, persisted: persist() };
}

/**
 * Put the last hidden frame back.
 *
 * ⚠ THIS IS THE SAFETY RAIL, not a nicety. A veto is spoken, and speech
 * misfires — a television line, a guest, a half-heard sentence. Without a way
 * back, one mishearing removes a photograph from the wall permanently and
 * silently, and the room would have no idea which one it lost.
 *
 * @returns {{ restored: string[], total: number, persisted: boolean }}
 */
export function undo() {
  const s = load();
  const restored = s.last ?? [];
  if (!restored.length) return { restored: [], total: s.ids.length, persisted: true };

  s.ids = s.ids.filter((id) => !restored.includes(id));
  s.last = [];
  return { restored, total: s.ids.length, persisted: persist() };
}

/** Tests only — the module holds process-lifetime state. */
export function __reset() {
  state = { ids: [], last: [] };
}
