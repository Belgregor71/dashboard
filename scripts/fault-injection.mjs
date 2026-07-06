// Fault injection for the motion-pipeline self-heal layer.
//
//   node scripts/fault-injection.mjs A     — detection-switch re-arm loop
//   node scripts/fault-injection.mjs B     — eufy driver reconnect actuator
//   node scripts/fault-injection.mjs all
//
// Test A injects a REAL fault on the live system: it turns the kitchen
// motion-detection switch off (the actual 2026-07-04 outage cause), restarts
// dashboard.service (worst case: server boots with the fault already present;
// also resets the anti-flap re-arm cooldown), and asserts the recovery
// service re-arms the switch within its window (5 one-minute evals + margin).
//
// Test B exercises the eufy push-lane actuator directly: driver
// disconnect/connect over the eufy-ws API, asserting the cloud push
// subscription comes back. Motion events are down for the few seconds the
// driver is disconnected — that's inherent to the repair being tested.

import { execFile } from "child_process";
import { promisify } from "util";
import { getEufyStatus, reconnectEufyDriver } from "../server/services/eufyWs.js";

const exec = promisify(execFile);

const DASH_URL = process.env.DASH_URL || "http://192.168.0.183:3000";
const PI_SSH = process.env.PI_SSH || "pi-dashboard";
const SWITCH = process.env.RECOVERY_TEST_SWITCH || "switch.kitchen_motion_detection";
const REARM_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS = 20_000;

const log = (msg) => console.log(`[${new Date().toLocaleTimeString("en-AU", { hour12: false })}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSwitchState() {
  const res = await fetch(`${DASH_URL}/api/ha/state/${encodeURIComponent(SWITCH)}`);
  if (!res.ok) throw new Error(`state fetch ${res.status}`);
  return (await res.json()).state;
}

async function turnOff() {
  const res = await fetch(`${DASH_URL}/api/ha/services/switch/turn_off`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity_id: SWITCH })
  });
  if (!res.ok) throw new Error(`turn_off ${res.status}: ${await res.text()}`);
}

async function waitForState(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await getSwitchState().catch(() => "unavailable");
    if (state === target) return true;
    log(`  ${SWITCH} = ${state} (waiting for ${target})`);
    await sleep(POLL_MS);
  }
  return false;
}

async function printRecoveryLog() {
  try {
    const res = await fetch(`${DASH_URL}/api/system/health`);
    const health = await res.json();
    const entries = (health.recoveries || []).slice(0, 5);
    log(`recovery log (latest ${entries.length}):`);
    for (const e of entries) {
      log(`  ${new Date(e.at).toLocaleTimeString("en-AU", { hour12: false })} [${e.kind}] ${e.action} — ${e.ok ? "ok" : "FAILED"}${e.detail ? ` (${e.detail})` : ""}`);
    }
  } catch (err) {
    log(`could not read recovery log: ${err.message}`);
  }
}

async function testA() {
  log(`TEST A — detection-switch re-arm (${SWITCH})`);

  let state = await getSwitchState();
  if (state !== "on") {
    log(`switch is currently "${state}" — waiting for it to be on before injecting (organic recovery may be in progress)`);
    if (!(await waitForState("on", REARM_TIMEOUT_MS))) {
      log("FAIL: switch never reached 'on'; cannot start injection from a known-good state");
      return false;
    }
  }

  log("injecting fault: turning switch off via allowlisted HA service");
  await turnOff();
  if (!(await waitForState("off", 60_000))) {
    log("FAIL: switch did not report 'off' after injection");
    return false;
  }

  log("restarting dashboard.service (boot-with-fault case; resets re-arm cooldown)");
  await exec("ssh", [PI_SSH, "sudo systemctl restart dashboard.service"]);

  log(`waiting for self-heal (recovery needs ~5 one-minute evals)…`);
  const recovered = await waitForState("on", REARM_TIMEOUT_MS);
  await printRecoveryLog();
  log(recovered ? "PASS: switch re-armed automatically" : "FAIL: switch still off after timeout");
  return recovered;
}

async function testB() {
  log("TEST B — eufy push-lane actuator (driver disconnect/connect)");
  const before = await getEufyStatus();
  log(`before: driver=${before.driverConnected} push=${before.pushConnected}`);

  const after = await reconnectEufyDriver();
  log(`after reconnect: driver=${after.driverConnected} push=${after.pushConnected}`);

  const ok = after.driverConnected && after.pushConnected;
  log(ok ? "PASS: driver and push lane reconnected" : "FAIL: push lane did not recover");
  return ok;
}

const which = (process.argv[2] || "all").toUpperCase();
const results = {};
if (which === "A" || which === "ALL") results.A = await testA();
if (which === "B" || which === "ALL") results.B = await testB();

console.log("\n=== fault injection results ===");
for (const [name, ok] of Object.entries(results)) {
  console.log(`  Test ${name}: ${ok ? "PASS" : "FAIL"}`);
}
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
