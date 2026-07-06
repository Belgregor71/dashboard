import WebSocket from "ws";

// Thin client for the eufy-security-ws API (the add-on between the Eufy cloud
// and Home Assistant). Used by the recovery service to check and repair the
// push lane, and by scripts/fault-injection.mjs to prove it works.

const DEFAULT_URL = "ws://192.168.0.179:3000"; // Synology; override with EUFY_WS_URL
const API_SCHEMA_MAX = 21;

export function eufyWsUrl() {
  return process.env.EUFY_WS_URL || DEFAULT_URL;
}

/**
 * Opens a session, negotiates the schema, runs `fn(send)` and closes.
 * `send(command, extra)` resolves with the result message.
 */
export async function withEufyWs(fn, { timeoutMs = 15_000 } = {}) {
  const ws = new WebSocket(eufyWsUrl());
  let msgId = 0;
  const pending = new Map();

  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("eufy-ws timeout"));
      ws.terminate();
    }, timeoutMs);

    const send = (command, extra = {}) =>
      new Promise((resolveCmd, rejectCmd) => {
        const messageId = String(++msgId);
        pending.set(messageId, { resolve: resolveCmd, reject: rejectCmd });
        ws.send(JSON.stringify({ messageId, command, ...extra }));
      });

    ws.on("message", async (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "version") {
        try {
          const schema = Math.min(msg.maxSchemaVersion ?? 0, API_SCHEMA_MAX);
          await send("set_api_schema", { schemaVersion: schema });
          resolve(await fn(send));
        } catch (err) {
          reject(err);
        } finally {
          clearTimeout(timer);
          ws.close();
        }
        return;
      }
      if (msg.type === "result" && pending.has(msg.messageId)) {
        const { resolve: res, reject: rej } = pending.get(msg.messageId);
        pending.delete(msg.messageId);
        if (msg.success) res(msg.result ?? {});
        else rej(new Error(`eufy-ws command failed: ${msg.errorCode || "unknown"}`));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  return done;
}

/** @returns {Promise<{driverConnected: boolean, pushConnected: boolean}>} */
export async function getEufyStatus() {
  return withEufyWs(async (send) => {
    const conn = await send("driver.is_connected");
    const push = await send("driver.is_push_connected");
    return {
      driverConnected: Boolean(conn.connected),
      pushConnected: Boolean(push.connected)
    };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Disconnect/connect the driver to re-establish the cloud push subscription,
 * then report the resulting status. This is the strongest repair available
 * without restarting the Synology container.
 */
export async function reconnectEufyDriver() {
  return withEufyWs(
    async (send) => {
      await send("driver.disconnect");
      await sleep(3_000);
      await send("driver.connect");
      // Cloud login + push registration take a few seconds.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await sleep(3_000);
        const conn = await send("driver.is_connected");
        const push = await send("driver.is_push_connected");
        if (conn.connected && push.connected) {
          return { driverConnected: true, pushConnected: true };
        }
      }
      const conn = await send("driver.is_connected");
      const push = await send("driver.is_push_connected");
      return {
        driverConnected: Boolean(conn.connected),
        pushConnected: Boolean(push.connected)
      };
    },
    { timeoutMs: 60_000 }
  );
}
