# Eufy push outage — runbook

Four cameras have delivered **zero** motion events for over a month. This is the
procedure for the one remaining lever, plus the cheap test that decides whether
that lever is worth pulling at all.

**Do not start at the bottom.** Section 2 is a twenty-minute test that can save
you the entire evening in section 3.

---

## 1. Status, measured 2026-09-04

Seven days of HA history, counting real `on` edges (not `unavailable` → `off`
re-registrations, which are registry noise and have misled this investigation
twice):

| Camera | Points | Real on-edges | Last real event |
|---|---|---|---|
| kitchen | 8 | **0** | never |
| side_gate | 8 | **0** | never |
| piano_room | 8 | **0** | never |
| tilt_pan | 8 | **0** | never |
| backyard | 49 | 20 | 2026-08-31 20:19Z |
| patio | 147 | 69 | 2026-09-03 08:43Z |
| front_yard | 79 | 35 | 2026-09-04 03:53Z |
| driveway | 467 | 229 | 2026-09-04 05:08Z |
| doorbell | 191 | 91 | 2026-09-04 04:29Z |

Same four cameras as the 2026-08-08 incident. The dead set has not grown —
backyard looks quiet in a states dump but has 20 real edges this week.

The chain was established in August as: camera ✅ → HomeBase ✅ → Eufy cloud ✅ →
**eufy-security-ws ❌** → HA. The owner confirmed kitchen events are visible in
the Eufy app while HA received none in the same window.

### ⚠ The cloud token expires 2026-09-04T09:16Z

Recorded in August as evidence the session was still valid. That expiry is
**today**. Two consequences:

- If it does not auto-refresh, the five *working* cameras are on the same clock.
- A forced re-login regenerates identity — which is precisely the lever section 3
  describes. The evening may stop being optional.

Check it before anything else:

```bash
# on the NAS, in the eufy-ws data volume
grep -o '"cloud_token_expiration":[0-9]*' /volume1/docker/homeassistant/eufy-ws-data/persistent.json
```

---

## 2. THE DECISION GATE — run this first

**The unresolved question that governs everything below:** driveway and doorbell
delivered events all week *while push registration was failing* with
`code: 4404, msg: 'get identity error'`. If push were the only delivery path,
they would be dead too.

The hypothesis that explains it: **live cameras arrive over the local station
link; dead cameras depend on cloud push.** The station list supports it —
eufy-ws connects three stations (`T8030T1324340CE2` Home base3,
`T8410P31214323A2`, `T8410P31214309FD`) and **there is no kitchen station**;
kitchen was re-homed. The dead set is largely the solo cameras, the live set are
devices on Home base3. (`side_gate`, a T8142-Z, does not fit the split — so treat
this as a strong pattern, not a proof. That is what the test is for.)

**If the hypothesis holds, a re-auth fixes nothing** — the dead cameras have no
delivery path to restore, and the fault is topology, not credentials.

### The test

```bash
ssh -i ~/.ssh/nas_synology BrettGreg@192.168.0.179
# sudo needs a PASSWORD here; key auth alone is not enough
sudo /usr/local/bin/docker logs --since 2h eufy-ws 2>&1 | grep -iE "push|station|onConnect|motionDetected|personDetected"
```

Read for **which transport carried a driveway or doorbell event**. You are
looking for whether a delivered event is preceded by push traffic or by station
traffic.

- **Events arrive on the station link** → re-auth is very unlikely to help.
  Stop. The next move is Eufy-app-side: re-home the kitchen/piano_room/tilt_pan
  cameras onto Home base3, or pair them to a station eufy-ws can see.
- **Events arrive via push** → push works for some devices and not others,
  the identity failure is the live suspect, and section 3 is worth the evening.
- **Inconclusive** → say so and stop. Do not default into the re-auth because it
  is the only remaining item on the list; that is how the last three evenings
  were spent.

---

## 3. Full re-auth — only if section 2 says so

The August partial fix dropped `push_credentials` + `push_persistentIds` while
keeping `cloud_token`/`login_hash`, deliberately avoiding a 2FA round. It cleared
the stale-token defect but surfaced an earlier failure: `code: 4404,
msg: 'get identity error'`. The remaining lever is to clear **the whole**
`persistent.json` so `openudid` and identity regenerate, then log in fresh.

⚠ This requires the Eufy account password and a 2FA code. Budget an evening.

```bash
ssh -i ~/.ssh/nas_synology BrettGreg@192.168.0.179
cd /volume1/docker/homeassistant

# 1. Stop the container.
sudo /usr/local/bin/docker compose -p homeassistant stop eufy-ws

# 2. Back it up. A dated name — persistent.json.pre-pushfix is the AUGUST
#    backup and must not be overwritten.
sudo cp eufy-ws-data/persistent.json eufy-ws-data/persistent.json.pre-reauth-2026-09-04

# 3. Clear it completely. This is the step the August attempt stopped short of.
sudo sh -c 'echo "{}" > eufy-ws-data/persistent.json'

# 4. Start, then log in fresh (credentials + 2FA) through the eufy-ws
#    interface. Watch the log live while you do it.
sudo /usr/local/bin/docker compose -p homeassistant start eufy-ws
sudo /usr/local/bin/docker logs -f eufy-ws
```

**What success looks like in the log:** no `4404 / get identity error`, and a
push registration that completes.

⚠ **`Push notification connection successfully established` IS NOT SUCCESS.**
It prints either way — it printed through the entire month-long outage. So did
`driverConnected: true, pushConnected: true`. The FCM socket being up says
nothing about whether the subscription behind it is live. **This is the single
most misleading signal in the whole stack; do not accept it as proof.**

---

## 4. Verification — with a positive control

An absence of events is not evidence, because an empty house is silent
everywhere. You need to know the pipeline was capable of reporting *something*
during the test window.

1. Walk into the **kitchen** and wave. (The subject.)
2. Walk down the **driveway**. (The positive control — a camera known to work. If
   this does not register either, your test window is broken, not the kitchen.)
3. Read both:

```bash
# from anywhere on the LAN
curl -s http://192.168.0.183:3000/api/ha/states \
  | node -e 'const s=JSON.parse(require("fs").readFileSync(0));for(const e of s){if(/^binary_sensor\.(kitchen|driveway)_motion_detected$/.test(e.entity_id))console.log(e.entity_id,e.state,e.last_changed)}'
```

**Read the `state`, not just `last_changed`** — a re-registration moves
`last_changed` without any motion having occurred, which is how "silent for N
hours" figures were wrong for a month. The claim you want is an `off` → `on`
transition, which means catching it inside the window or reading history:

```bash
# on the G11, where the HA token lives
TOK=$(grep ^HA_TOKEN= /home/dashboard/dashboard/.env | cut -d= -f2- | tr -d '"')
curl -s -H "Authorization: Bearer $TOK" \
  "http://192.168.0.179:8123/api/history/period/<startZ>?end_time=<endZ>&filter_entity_id=binary_sensor.kitchen_motion_detected"
```

⚠ `end_time` **must** be `Z`-suffixed. A `+00:00` returns
`{"message":"Invalid end_time"}`, which reads like a bad entity id and has cost
an hour before.

The dashboard's own verdict, once events resume, is:

```bash
curl -s http://192.168.0.183:3000/api/system/health   # motionCoverage feed + per-camera table
```

---

## 5. Ruled out — do not re-run

Each of these cost real time and produced nothing. They are closed.

| Tried | Result |
|---|---|
| Restart the eufy-ws container | No effect (owner, 2026-08-09) |
| `homeassistant.reload_config_entry` | Re-registers device entities; **cannot** purge rows for devices the integration no longer reports (2026-08-12) |
| Remove + re-add the HA integration | Would not help — fault is upstream of HA, which faithfully reports what it is given |
| Update the image | **No newer image exists.** `bropat/eufy-security-ws:latest` returns the identical digest `sha256:66595a7e…`, built 2026-07-01 |
| Clear push credentials only | Cleared the stale token; exposed `4404 get identity error` one step earlier |
| Guard mode / armed_home | Unbroken all week, including while cameras worked |
| Dropped websocket | One close in a 7-day log, and it was ours |
| Deleting the HA device registry row | Would take the working kitchen camera entities with it |

**Urgency is low by design:** `soundPresence` was flipped default-on
(`09d8a7e`) and proven to mark presence on its own while every camera was
frozen. The wall is not blind. This is a correctness problem, not an outage.
