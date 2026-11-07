/* ═══════════════════════════════════════════════════════════════════════════
   PARCELS — Mail and Packages (HACS, Gmail OAuth) tells the wall a parcel is
   coming, or has come. Behind features.v3Parcels.

   Emits `parcel:moment` on the bus; parcel-animation.js renders the moment.

   The entity ids carry the Gmail address (`sensor.<area>_<email>_mail_packages_
   delivering`) and config.js ships in the public bundle, so the sensors are
   matched by SUFFIX, never named. The per-carrier sensors (`…_mail_auspost_
   delivering`) do not match; only the two totals do.

   Two guards, both the shape alerts.js already paid for:
   1. The boot snapshot replays today's counts. A state older than FRESH_MS
      seeds the baseline and is not announced, so a reload says nothing.
   2. The integration re-parses today's mail on every poll and the count can
      dip and come back. Only a count ABOVE today's highest is a moment.
   ═══════════════════════════════════════════════════════════════════════════ */

import { on, emit } from "../../js/core/eventBus.js";
import { initParcelAnimation } from "./parcel-animation.js";
import { record, localDay } from "./feature-census.js";

export const PARCEL_FRESH_MS = 10 * 60_000;

const KINDS = {
  delivering: "_mail_packages_delivering",
  delivered: "_mail_packages_delivered"
};

const flag = (name) => Boolean(globalThis.window?.CONFIG?.features?.[name]);

/** "delivering" | "delivered" | null */
export function parcelKind(entityId) {
  if (typeof entityId !== "string" || !entityId.startsWith("sensor.")) return null;
  for (const [kind, suffix] of Object.entries(KINDS)) if (entityId.endsWith(suffix)) return kind;
  return null;
}

/**
 * Pure decision. `seen` is { day, delivering, delivered } and is updated in
 * place. Returns { kind, count, previous } for a new parcel, else null.
 */
export function decideParcel(entity, seen, now = Date.now()) {
  const kind = parcelKind(entity?.entity_id);
  if (!kind) return null;
  const count = Number(entity.state);
  if (!Number.isInteger(count) || count < 0) return null;   // unknown / unavailable

  const day = localDay(new Date(now));
  if (seen.day !== day) Object.assign(seen, { day, delivering: 0, delivered: 0 });

  const previous = seen[kind];
  if (count <= previous) return null;
  seen[kind] = count;

  const changed = Date.parse(entity.last_changed);
  if (!(now - changed <= PARCEL_FRESH_MS)) return null;     // boot snapshot: baseline only
  return { kind, count, previous };
}

const seen = { day: null, delivering: 0, delivered: 0 };
let unsubscribe = null;
let last = null;

function onStateUpdated(entity, now = Date.now()) {
  const moment = decideParcel(entity, seen, now);
  if (!moment) return null;
  record("parcel", moment.kind, "moment");
  last = { ...moment, at: new Date(now).toISOString() };
  emit("parcel:moment", last);
  return last;
}

/** The last parcel moment, or null. For __v3(). */
export function lastParcel() {
  return last;
}

export function initParcels() {
  if (unsubscribe || !flag("v3Parcels")) return unsubscribe;
  initParcelAnimation();
  unsubscribe = on("ha:state-updated", (entity) => { onStateUpdated(entity); });

  /* Drive a parcel without waiting for the post. Goes through the same guards,
     so a count at or below today's highest says nothing — pass a higher one. */
  window.__v3Parcel = (kind = "delivering", count = seen[kind] + 1) =>
    onStateUpdated({
      entity_id: `sensor.test${KINDS[kind]}`,
      state: String(count),
      last_changed: new Date().toISOString()
    });

  return unsubscribe;
}
