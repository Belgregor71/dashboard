import { fetchPeopleBirthdaysResult, personDayResult } from "./immichClient.js";

// A birthday on the ambient ground (FIELD-SCAN round 2, #9).
//
// On someone's birthday the on-this-day pool leans toward photographs of them
// taken ON their birthday in past years — about half of what the wall walks
// through that day — and each of those says so: "Melanie's birthday 2019".
// Every other day of the year this does nothing at all.
//
// The occasion source is Immich's own person `birthDate`, so the date is keyed
// to a face cluster and never to a name typed twice. Measured 2026-10-24: 10 of
// 186 named people carry one; the two household birthdays in DOG_BIRTHDAYS are
// among them with the same dates. Owner's choices (2026-10-24): all of them
// minus a skip list, the day itself only, about half, and the caption names it.
//
// Two halves, split on the route's memo the same way photoNames/photoTrips are:
//   withOccasions  — INSIDE the hourly memo. Fetches and reweights the pool,
//                    marking each birthday photograph with an internal
//                    `birthdayOf` (a FULL name, which must never leave here).
//   labelOccasions — OUTSIDE it, on the way out. Turns the mark into the
//                    caption phrase and always deletes the mark.
//
// OFF ⇒ IDENTITY. With IMMICH_OCCASIONS unset, withOccasions hands back the very
// object it was given and labelOccasions finds no marks, so the route's answer
// is byte-identical to before. That is the rollback: delete the line, restart.

// ── env (quote-stripping, the .env gotcha) ─────────────────────
// Read PER REQUEST: server.js's static imports evaluate before dotenv.config().
function envVal(key) {
  const raw = process.env[key];
  return raw ? raw.trim().replace(/^["']|["']$/g, "") : null;
}

export function occasionsEnabled() {
  return envVal("IMMICH_OCCASIONS") === "1";
}

/** Full Immich names whose birthday the wall must not mark. */
export function skipNames() {
  const raw = envVal("IMMICH_OCCASION_SKIP");
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

// Same normal form photoMemory.nameSegment compares on: both sides are free
// text somebody typed.
const key = (n) => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();

const YEARS_BACK = 15;  // the on-this-day pool's own reach
// The floor under "about half". A day with two birthday photographs would
// otherwise walk a pool of four, and the ground repeats a pool once it runs out.
const MIN_OTHERS = 6;

/**
 * Whose birthday falls on `now`'s local day, minus the skip list.
 *
 * 29 February is matched only on 29 February — the birthday simply does not
 * come round in other years, the same call dogs.js parseBirthdays makes.
 *
 * @returns {Array<{id, name, birthYear}>}
 */
export function birthdaysOn(people, now = new Date(), skip = []) {
  const skipped = new Set(skip.map(key));
  const out = [];
  for (const p of people || []) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(p?.birthDate || ""));
    if (!m || !p.id || !p.name) continue;
    if (Number(m[2]) !== now.getMonth() + 1 || Number(m[3]) !== now.getDate()) continue;
    if (skipped.has(key(p.name))) continue;
    out.push({ id: p.id, name: p.name, birthYear: Number(m[1]) });
  }
  return out;
}

/* The photograph's own local month-day, read off the string (photoTrips.dayOf
   explains why never through a Date: Thailand is UTC+7). */
function monthDayOf(asset) {
  const raw = asset?.localDateTime;
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(5, 10) : null;
}

/**
 * Reweight a day's pool around the birthday photographs.
 *
 * A photograph counts when the person is in it AND it was taken on the
 * birthday's month-day — a photo of them from the day after the party is not
 * "their birthday", and the caption would be making that up. They come first,
 * newest year first (the depth-3 grid reads the pool in order). The rest of the
 * pool is thinned to as many again, floor MIN_OTHERS, picked evenly across it so
 * the years stay spread rather than the most recent few surviving.
 *
 * Pure. Never mutates its inputs.
 *
 * @param {Array} pool       the on-this-day assets
 * @param {Array} extra      assets from personDayResult (may overlap the pool)
 * @param {Array<{name}>} birthdays  from birthdaysOn
 * @param {Date} now
 */
export function weightPool(pool, extra, birthdays, now = new Date()) {
  const md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const wanted = birthdays.map((b) => ({ k: key(b.name), name: b.name }));

  const marked = [];
  const seen = new Set();
  for (const a of [...(pool || []), ...(extra || [])]) {
    if (!a?.id || seen.has(a.id) || monthDayOf(a) !== md) continue;
    const people = (a.people || []).map(key);
    const who = wanted.find((w) => people.includes(w.k));
    if (!who) continue;
    seen.add(a.id);
    marked.push({ ...a, birthdayOf: who.name });
  }
  if (!marked.length) return pool;

  marked.sort((x, y) => String(y.localDateTime).localeCompare(String(x.localDateTime)));

  const others = (pool || []).filter((a) => a?.id && !seen.has(a.id));
  const keep = Math.max(marked.length, MIN_OTHERS);
  const thinned = others.length <= keep
    ? others
    : Array.from({ length: keep }, (_, i) => others[Math.floor((i * others.length) / keep)]);

  return [...marked, ...thinned];
}

/**
 * The pool, leaned toward today's birthdays. Runs inside the route's memo, so
 * it answers the memo's `{ ok, assets }` contract.
 *
 * ⚠ A failed people or person fetch makes the whole answer `ok:false`, i.e.
 * NOT cached. A pool that silently missed somebody's birthday would otherwise be
 * pinned for the hour — and "no birthday on the wall" is not something anyone
 * would think to report.
 *
 * @param {Promise<{ok, assets}>|{ok, assets}} result  the plain on-this-day answer
 * @param {Date} now
 * @param {object} deps  test seam over the two Immich calls
 */
export async function withOccasions(result, now = new Date(), deps = {}) {
  const base = await result;
  if (!occasionsEnabled() || !base?.ok) return base;

  const fetchPeople = deps.fetchPeople ?? fetchPeopleBirthdaysResult;
  const searchDay = deps.searchDay ?? personDayResult;

  const people = await fetchPeople();
  if (!people.ok) return { ok: false, assets: base.assets };

  const birthdays = birthdaysOn(people.people, now, skipNames());
  if (!birthdays.length) return base;

  const thisYear = now.getFullYear();
  const searches = await Promise.all(birthdays.map((b) => {
    const years = [];
    const oldest = Math.max(thisYear - YEARS_BACK, Number.isFinite(b.birthYear) ? b.birthYear : 0);
    for (let y = thisYear - 1; y >= oldest; y--) years.push(y);
    return searchDay(b.id, now.getMonth(), now.getDate(), years);
  }));
  const extra = searches.flatMap((s) => s.assets || []);
  return {
    ok: searches.every((s) => s.ok),
    assets: weightPool(base.assets, extra, birthdays, now)
  };
}

/**
 * Turn each birthday mark into the caption's occasion — "Melanie's birthday
 * 2019" — and ALWAYS strip the mark, which holds a full name.
 *
 * The phrase rides in `trip`, the field the ground already reads as "the
 * occasion the photograph belonged to" (ground.js tripOf): it replaces the bare
 * year, so the year is appended here from the photograph, exactly as
 * photoTrips does. That is why no client change was needed.
 *
 * The person is taken out of `people`, or the line would read "Melanie ·
 * Melanie's birthday 2019". Someone on the never-name list (the residents)
 * gets "Birthday 2019": the rule is that they are never named, and on their
 * own wall nobody needs telling whose birthday it is.
 *
 * Must run BEFORE labelPeople, which rewrites `people` into a phrase that can
 * no longer be edited by name.
 *
 * @param {Array} assets
 * @param {{hideNames: string[], nameFor: (full: string) => string}} opts
 */
export function labelOccasions(assets, { hideNames = [], nameFor = (n) => n } = {}) {
  const list = Array.isArray(assets) ? assets : [];
  if (!list.some((a) => a && "birthdayOf" in a)) return list;

  const hidden = new Set(hideNames.map(key));
  return list.map((asset) => {
    if (!asset || !("birthdayOf" in asset)) return asset;
    const { birthdayOf, ...rest } = asset;
    const year = String(rest.localDateTime || "").slice(0, 4);
    if (!birthdayOf || !/^\d{4}$/.test(year)) return rest;
    const who = hidden.has(key(birthdayOf)) ? "" : nameFor(birthdayOf);
    return {
      ...rest,
      people: (rest.people || []).filter((p) => key(p) !== key(birthdayOf)),
      trip: who ? `${who}'s birthday ${year}` : `Birthday ${year}`
    };
  });
}
