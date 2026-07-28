import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { readHaConfig } from "../server/ha/haConfig.js";

// Audit 2026-07-26 M1 (§10, "Single point of failure"): a malformed HA config
// threw at startup and the server called process.exit(1) — so one bad env line
// took down weather, calendar, recipes, photos and the clock, none of which
// need Home Assistant. The kiosk showed a blank screen for an HA typo.
//
// The fix is that a missing HA_HOST/HA_TOKEN now reports the same `enabled`
// as the long-supported HA_ENABLED=0 path, which the whole stack already knows
// how to degrade through (haRoutes serves a 503 catch-all, healthService and
// recoveryService take a null manager, attachHaProxy skips).

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const HA_KEYS = ["HA_HOST", "HA_URL", "HA_TOKEN", "HA_ENABLED"];

function withEnv(overrides, fn) {
  const saved = Object.fromEntries(HA_KEYS.map((k) => [k, process.env[k]]));
  for (const k of HA_KEYS) delete process.env[k];
  Object.assign(process.env, overrides);
  try {
    return fn();
  } finally {
    for (const k of HA_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}

test.describe("HA config degrades instead of exiting", () => {
  test("missing host and token disables HA without throwing", () => {
    withEnv({}, () => {
      const config = readHaConfig({ requireConfig: false });
      expect(config.enabled).toBe(false);
      expect(config.missing).toEqual(["HA_HOST", "HA_TOKEN"]);
    });
  });

  test("a half-configured HA is disabled, not enabled-and-broken", () => {
    withEnv({ HA_HOST: "http://homeassistant.local:8123" }, () => {
      const config = readHaConfig({ requireConfig: false });
      expect(config.enabled).toBe(false);
      expect(config.missing).toEqual(["HA_TOKEN"]);
    });
  });

  test("a complete config is enabled and trailing-slash normalised", () => {
    withEnv({ HA_HOST: "http://homeassistant.local:8123/", HA_TOKEN: " tok " }, () => {
      const config = readHaConfig();
      expect(config.enabled).toBe(true);
      expect(config.missing).toEqual([]);
      expect(config.haHost).toBe("http://homeassistant.local:8123");
      expect(config.haToken).toBe("tok");
    });
  });

  test("HA_ENABLED=0 still wins over a complete config", () => {
    withEnv({ HA_ENABLED: "0", HA_HOST: "http://ha.local:8123", HA_TOKEN: "tok" }, () => {
      expect(readHaConfig().enabled).toBe(false);
    });
  });

  // haRest/haWs keep requireConfig:true so a credential-less upstream call is a
  // loud, catchable rejection rather than a fetch to "undefined/api/states".
  test("requireConfig still throws for the callers that need credentials", () => {
    withEnv({ HA_HOST: "http://ha.local:8123" }, () => {
      expect(() => readHaConfig()).toThrow(/missing HA_TOKEN/);
    });
  });

  // The regression that actually matters: nothing on the HA config path may
  // kill the process. A bad token must cost HA, not the dashboard.
  test("server.js does not exit on HA config", () => {
    const source = readFileSync(join(root, "server.js"), "utf8");
    expect(source).not.toMatch(/process\.exit/);
  });
});
