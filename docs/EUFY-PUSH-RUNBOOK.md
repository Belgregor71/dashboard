# Eufy motion outage — runbook

Three cameras have delivered **zero** motion events for over a month. This is
what has been measured, what has been ruled out, and the one test that still
splits the remaining hypotheses.

> ⚠ **Revised 2026-09-05.** The first version of this runbook led with a
> decision gate built on the theory that the dead cameras were *solo cameras on
> a station eufy-ws cannot see*, while the live ones sat on Home base3. **A
> direct probe of eufy-ws falsified that** — see §3. If you read the earlier
> version, discard the station/re-homing branch entirely.

---

## 1. Status, measured

### On-edge counts — 7 days of HA history, 2026-09-04

Counting real `on` edges, **not** `unavailable` → `off` re-registrations, which
are registry noise and have misled this investigation three times (see
`reference-ha-restamp-is-not-an-event` in project memory).

| Camera | Points | Real on-edges | Verdict |
|---|---|---|---|
| kitchen | 8 | **0** | ❌ dead |
| side_gate | 8 | **0** | ❌ dead |
| piano_room | 8 | **0** | ❌ dead |
| tilt_pan | 8 | 0 | ✅ **not a fault — see below** |
| backyard | 49 | 20 | ✅ |
| patio | 147 | 69 | ✅ |
| front_yard | 79 | 35 | ✅ |
| driveway | 467 | 229 | ✅ |
| doorbell | 191 | 91 | ✅ |

### 🔑 The dead set is THREE, not four

**`tilt_pan` has motion detection switched OFF at the device.** eufy-ws reports
that camera (it is named **Garage**, `T8410P31214323A2`, on its own station)
with `motionDetection=false`. Zero events is the correct and expected outcome.
It has been counted as a fault since 2026-08-08 and it never was one.

⚠ If you *want* the garage camera detecting motion, that is a separate,
one-setting job in the Eufy app — not part of this outage.

---

## 2. The chain, as established

Camera ✅ → HomeBase ✅ → Eufy cloud ✅ → **eufy-security-ws ❓** → HA ❓

The owner confirmed in August that kitchen events **are visible in the Eufy
app** (07:00, 14:07, 17:51, 18:00 on 2026-08-12) while HA received zero in the
same period. So everything up to the cloud works. The break is at or after
eufy-security-ws — and §4 is the test that says which.

---

## 3. ⛔ FALSIFIED — the station / re-homing theory

**Do not spend time here. This was probed directly on 2026-09-05 and the answer
is unambiguous.**

The theory was: dead cameras are solo devices on stations eufy-ws cannot see;
live cameras are devices on Home base3; therefore re-auth would fix nothing and
the answer was to re-home the dead ones in the Eufy app.

What eufy-ws actually reports:

| Device | Serial | Station | Station connected | motionDetection |
|---|---|---|---|---|
| **Kitchen** | T8400P2020401CCB | Home base3 | ✅ true | true |
| **Side Gate** | T8142N63213234A5 | Home base3 | ✅ true | true |
| Patio | T8142N6321322FB5 | Home base3 | ✅ true | true |
| Front yard | T8142N6321324822 | Home base3 | ✅ true | true |
| Backyard | T8142N63213238D1 | Home base3 | ✅ true | true |
| Driveway | T8124P3122443D52 | Home base3 | ✅ true | true |
| Doorbell | T8210P3421280A30 | Home base3 | ✅ true | true |
| **Piano Room** | T8410P31214309FD | Piano Room (own) | ✅ true | true |
| Garage (`tilt_pan`) | T8410P31214323A2 | Garage (own) | ✅ true | **false** |

Three findings kill the theory:

1. **Kitchen and Side Gate are on Home base3** — the same connected station as
   all five working cameras. Kitchen was re-homed at some point after the August
   notes were written (which is also why HA still carried stale, `unavailable`
   *Kitchen station* entities). It is already where the theory said to move it.
2. **Side Gate is the same model (`T8142N…`) as Patio, Front yard and Backyard**
   — three cameras that work — on the same station. Not a model fault.
3. Every station eufy-ws knows is **connected=true**.

⇒ **The fault is PER-DEVICE.** Not per-station, not per-model, not per-transport.
eufy-ws sees these devices, on a connected station, with detection enabled, and
gets nothing from them specifically.

### The probe, so it can be re-run

Run it from the G11 (it has `ws` in `node_modules`; eufy-ws is on the NAS at
`ws://192.168.0.179:3000`). ⚠ At schema 21 `start_listening` returns **arrays of
serial-number strings**, not objects — you must ask for each device's properties
separately. An earlier attempt printed nine rows of `undefined` for exactly this
reason.

```js
// /tmp/eufy-topo.mjs — see git history of this file for the full script
await ask("set_api_schema", { schemaVersion: 21 });
const { stations, devices } = (await ask("start_listening")).result.state;
for (const sn of stations) {
  await ask("station.get_properties", { serialNumber: sn });  // .name
  await ask("station.is_connected",   { serialNumber: sn });  // .connected
}
for (const sn of devices) {
  await ask("device.get_properties",  { serialNumber: sn });  // .name, .stationSerialNumber, .motionDetection
}
```

---

## 4. ▶▶ THE DECISION GATE — listen below HA

**This is the test to run. It needs about five minutes and a walk.**

Everything so far has been read *through* Home Assistant, which is one layer too
high to tell these two apart:

- **A — eufy-ws emits a Kitchen motion event, HA shows nothing.** The break is
  **eufy-ws → HA**. Most likely the HA entity is still bound to Kitchen's old
  station identity from before it was re-homed. Fix is HA-side and cheap.
- **B — eufy-ws emits nothing for Kitchen while Driveway fires.** The break is
  **upstream of eufy-ws**, per-device. Then, and only then, §5 is worth the
  evening.

### Run it

Connect to the eufy-ws socket and print every device event as it arrives, then
walk both cameras.

```js
// Listen and print. Same connect + set_api_schema + start_listening as §3.
ws.on("message", (buf) => {
  const m = JSON.parse(buf.toString());
  if (m.type !== "event") return;
  const e = m.event || {};
  // Print everything device-scoped; do NOT filter to motionDetected only —
  // the useful negative result is "chatter arrives for Kitchen but no motion".
  if (e.source === "device") {
    console.log(new Date().toISOString(), e.serialNumber, e.event, JSON.stringify(e.value));
  }
});
```

Serials worth watching: **Kitchen `T8400P2020401CCB`** (subject) and
**Driveway `T8124P3122443D52`** (positive control).

1. Start the listener.
2. Walk into the **kitchen** and wave. Note the wall-clock time.
3. Walk down the **driveway**. Note the time.
4. Read the output.

⚠ **The positive control is not optional.** An absence of events proves nothing
on its own — an empty house is silent everywhere, and two of the three
"inconclusive" results in this investigation were quiet windows mistaken for
evidence. If Driveway does not fire either, your test window is broken, not the
kitchen.

### ⛔ What NOT to use as the gate

`docker logs --since 2h eufy-ws | grep -iE "push|station|motionDetected"`
returned **zero lines** on 2026-09-05. That is a **failed measurement, not a
result** — at the container's default verbosity those lines are not emitted, and
a quiet two hours looks identical to a broken pipeline. Do not read anything
into it either way.

---

## 5. Full re-auth — ONLY if §4 returns branch B

The August partial fix dropped `push_credentials` + `push_persistentIds` while
keeping `cloud_token`/`login_hash`, deliberately avoiding a 2FA round. It cleared
the stale-token defect and surfaced an earlier failure: `code: 4404,
msg: 'get identity error'`. The remaining lever is to clear **the whole**
`persistent.json` so `openudid` and identity regenerate, then log in fresh.

⚠ Needs the Eufy account password and a 2FA code. Budget an evening. NAS docker
needs a sudo **password** — key auth alone fails as `gdee7`; the user is
`BrettGreg`.

```bash
ssh -i ~/.ssh/nas_synology BrettGreg@192.168.0.179
cd /volume1/docker/homeassistant

sudo /usr/local/bin/docker compose -p homeassistant stop eufy-ws

# Dated name — persistent.json.pre-pushfix is the AUGUST backup, do not clobber.
sudo cp eufy-ws-data/persistent.json eufy-ws-data/persistent.json.pre-reauth-$(date +%F)

# Clear it completely. This is the step the August attempt stopped short of.
sudo sh -c 'echo "{}" > eufy-ws-data/persistent.json'

sudo /usr/local/bin/docker compose -p homeassistant start eufy-ws
sudo /usr/local/bin/docker logs -f eufy-ws   # log in fresh while watching
```

**Success looks like:** no `4404 / get identity error`, and a push registration
that completes.

⚠⚠ **`Push notification connection successfully established` IS NOT SUCCESS.**
It printed throughout the entire month-long outage, as did
`driverConnected: true, pushConnected: true`. The FCM socket being up says
nothing about whether the subscription behind it is live. **This is the single
most misleading signal in the stack.**

---

## 6. Verifying a fix — with a positive control

Read the **`on` edge**, not `last_changed`: a re-registration moves
`last_changed` without any motion having occurred, which is how "silent for N
hours" figures were wrong for a month.

```bash
# on the G11, where the HA token lives
TOK=$(grep ^HA_TOKEN= /home/dashboard/dashboard/.env | cut -d= -f2- | tr -d '"')
curl -s -H "Authorization: Bearer $TOK" \
  "http://192.168.0.179:8123/api/history/period/<startZ>?end_time=<endZ>&filter_entity_id=binary_sensor.kitchen_motion_detected"
```

⚠ `end_time` **must** be `Z`-suffixed. A `+00:00` returns
`{"message":"Invalid end_time"}`, which reads like a bad entity id.

The dashboard's own verdict:

```bash
curl -s http://192.168.0.183:3000/api/system/health   # motionCoverage feed + per-camera table
```

⚠ `motionCoverage` reading **`ok` is not proof of a fix.** It faults on
*divergence* — it needs the rest of the house to have been demonstrably busy
(≥12 events) before a camera's silence counts as evidence. On a quiet night it
correctly reads `ok` with the kitchen stone dead. Read the **on-edge count**, not
the feed.

---

## 7. Ruled out — do not re-run

| Tried | Result |
|---|---|
| **Station / re-homing theory** | ❌ **Falsified 2026-09-05** — Kitchen and Side Gate are already on Home base3, connected, beside five working cameras (§3) |
| **Cloud token expiry** | ❌ **Not a factor.** Auto-renews. August recorded `2026-09-04T09:16Z`; on 09-05 it read `2026-10-03T09:16:03Z` — same second, one month on |
| `docker logs \| grep` as the gate | ❌ Zero lines at default verbosity — a failed measurement, not a result |
| Restart the eufy-ws container | No effect (owner, 2026-08-09) |
| `homeassistant.reload_config_entry` | Re-registers device entities; **cannot** purge rows for devices the integration no longer reports (2026-08-12) |
| Remove + re-add the HA integration | Not indicated — HA faithfully reports what it is given |
| Update the image | **No newer image exists.** `bropat/eufy-security-ws:latest` returns the identical digest `sha256:66595a7e…`, built 2026-07-01 |
| Clear push credentials only | Cleared the stale token; exposed `4404 get identity error` one step earlier |
| Guard mode / `armed_home` | Unbroken all week, including while cameras worked |
| Dropped websocket | One close in a 7-day log, and it was ours |
| Deleting the HA device registry row | Would take the working kitchen camera entities with it |
| A tighter `staleMs` on the detector | Cannot work at any value — an empty house is silent everywhere. Divergence is the only rule immune to it |

**Urgency is low by design.** `soundPresence` was flipped default-on (`09d8a7e`)
and proven to mark presence on its own while every camera was frozen. The wall
is not blind. This is a correctness problem, not an outage.
