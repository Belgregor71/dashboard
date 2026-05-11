import express from "express";
import { getHaWsManager } from "./haWs.js";
import { haDelete, haGet, haPatch, haPost } from "./haRest.js";
import { readHaConfig } from "./haConfig.js";

const SAFE_SERVICES = new Set([
  "script.turn_on",
  "input_select.select_option",
  "light.turn_on",
  "light.turn_off",
  "switch.turn_on",
  "switch.turn_off",
  "media_player.media_play",
  "media_player.media_pause",
  "media_player.media_stop",
  "media_player.volume_set"
]);

function toSse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function mapError(error) {
  return {
    status: error?.status || 502,
    error: error?.message || "Home Assistant request failed",
    detail: error?.payload || null
  };
}

export function createHaRouter() {
  const router = express.Router();
  const { haHost, enabled } = readHaConfig({ requireConfig: false });

  if (!enabled) {
    router.get("/health", (_req, res) => {
      res.json({
        ok: true,
        enabled: false,
        haHost,
        connected: false,
        lastError: null,
        lastConnectedAt: null
      });
    });

    router.get("/stream", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      res.write(toSse("ha_status", {
        enabled: false,
        connected: false,
        lastError: null,
        lastConnectedAt: null
      }));
      res.end();
    });

    router.use((_req, res) => {
      res.status(503).json({
        error: "Home Assistant integration disabled",
        detail: "Set HA_ENABLED=1 with HA_HOST and HA_TOKEN to enable /api/ha routes."
      });
    });

    return router;
  }

  const manager = getHaWsManager();

  manager.start();
  void manager.ensureInitialStates();

  router.get("/health", (_req, res) => {
    const { haHost: currentHaHost, enabled: currentEnabled } = readHaConfig({ requireConfig: false });
    res.json({
      ok: true,
      enabled: currentEnabled,
      haHost: currentHaHost,
      ...manager.getStatus()
    });
  });

  router.get("/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    await manager.ensureInitialStates();
    res.write(toSse("ha_status", manager.getStatus()));
    res.write(toSse("ha_snapshot", manager.getStates()));

    const onStatus = (status) => res.write(toSse("ha_status", status));
    const onSnapshot = (states) => res.write(toSse("ha_snapshot", states));
    const onEvent = ({ eventType, data }) => {
      if (!eventType) return;
      res.write(toSse(eventType, data));
    };

    manager.on("status", onStatus);
    manager.on("snapshot", onSnapshot);
    manager.on("event", onEvent);

    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 20_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      manager.off("status", onStatus);
      manager.off("snapshot", onSnapshot);
      manager.off("event", onEvent);
    });
  });

  router.get("/states", async (_req, res) => {
    await manager.ensureInitialStates();
    res.json(manager.getStates());
  });

  router.get("/state/:entityId", async (req, res) => {
    const entityId = decodeURIComponent(req.params.entityId);
    await manager.ensureInitialStates();
    const state = manager.getState(entityId);
    if (state) {
      res.json(state);
      return;
    }

    try {
      const fetched = await haGet(`/api/states/${encodeURIComponent(entityId)}`);
      res.json(fetched);
    } catch (error) {
      const mapped = mapError(error);
      res.status(mapped.status).json(mapped);
    }
  });

  router.get("/todo/:entityId/items", async (req, res) => {
    try {
      const entityId = decodeURIComponent(req.params.entityId);
      const result = await haGet(`/api/todo/${encodeURIComponent(entityId)}/items`);
      res.json(result);
    } catch (error) {
      const mapped = mapError(error);
      res.status(mapped.status).json(mapped);
    }
  });

  router.get("/shopping_list", async (_req, res) => {
    try {
      res.json(await haGet("/api/shopping_list"));
    } catch (error) {
      const mapped = mapError(error);
      res.status(mapped.status).json(mapped);
    }
  });

  router.post("/shopping_list", async (req, res) => {
    try {
      res.json(await haPost("/api/shopping_list", { name: req.body?.name }));
    } catch (error) {
      const mapped = mapError(error);
      res.status(mapped.status).json(mapped);
    }
  });

  router.patch("/shopping_list/:id", async (req, res) => {
    try {
      res.json(await haPatch(`/api/shopping_list/${encodeURIComponent(req.params.id)}`, req.body || {}));
    } catch (error) {
      const mapped = mapError(error);
      res.status(mapped.status).json(mapped);
    }
  });

  router.delete("/shopping_list/:id", async (req, res) => {
    try {
      res.json(await haDelete(`/api/shopping_list/${encodeURIComponent(req.params.id)}`));
    } catch (error) {
      const mapped = mapError(error);
      res.status(mapped.status).json(mapped);
    }
  });

  router.post("/services/:domain/:service", async (req, res) => {
    const domain = req.params.domain;
    const service = req.params.service;
    const key = `${domain}.${service}`;
    if (!SAFE_SERVICES.has(key)) {
      res.status(403).json({ error: `Service ${key} is not allowlisted` });
      return;
    }

    try {
      res.json(await haPost(`/api/services/${domain}/${service}`, req.body || {}));
    } catch (error) {
      const mapped = mapError(error);
      res.status(mapped.status).json(mapped);
    }
  });

  return router;
}
