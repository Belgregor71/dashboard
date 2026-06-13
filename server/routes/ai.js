import express from "express";
import { compileSchema, validateBody, validateData } from "../middleware/validate.js";
import { aiBriefBodySchema, aiRouteBodySchema, aiRouteResultSchema } from "../schemas/ai.js";
import { fetchWithTimeout } from "../utils/fetch.js";

const router = express.Router();

const validateAiRouteBody = compileSchema(aiRouteBodySchema);
const validateAiBriefBody = compileSchema(aiBriefBodySchema);
const validateAiRouteResult = compileSchema(aiRouteResultSchema);

const aiRouteCache = new Map();
const aiBriefCache = new Map();

function getCached(cache, key) {
  const item = cache.get(key);
  if (!item) return null;
  if (item.expiresAt < Date.now()) { cache.delete(key); return null; }
  return item.value;
}

function setCached(cache, key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function fallbackAiRoute() {
  return { intent: "unknown", confidence: 0, response: "Sorry, I didn't get that." };
}

function coerceAiRoute(payload = {}) {
  const validIntents = new Set([
    "switch_view", "show_weather", "show_cameras", "show_calendar", "status_explain", "unknown"
  ]);
  const validViews = new Set(["home", "weather", "cameras", "calendar", "agenda", "status", "briefing"]);
  const intent = validIntents.has(payload.intent) ? payload.intent : "unknown";
  const view = validViews.has(payload.view) ? payload.view : undefined;
  const confidence = Number.isFinite(payload.confidence)
    ? Math.max(0, Math.min(1, payload.confidence)) : 0;
  const response = typeof payload.response === "string" && payload.response.trim()
    ? payload.response.trim().slice(0, 180) : "Okay.";
  return view ? { intent, view, confidence, response } : { intent, confidence, response };
}

function parseModelJson(rawText) {
  const trimmed = rawText?.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try { return JSON.parse(candidate); } catch { return null; }
}

async function callGeminiJson({ prompt, schemaExample, timeoutMs = 10_000 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  if (!apiKey) {
    const err = new Error("AI not configured");
    err.status = 501;
    throw err;
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: `${prompt}\n\nReturn strictly JSON only. Example: ${schemaExample}` }]
        }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
      })
    },
    timeoutMs
  );
  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`Gemini HTTP ${response.status}`);
    err.detail = errorText;
    throw err;
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseModelJson(text);
}

function normalizeAiRouteBody(req, _res, next) {
  if (req.body?.input) return next();
  if (typeof req.body?.text === "string") req.body = { input: { text: req.body.text } };
  next();
}

function normalizeAiBriefBody(req, _res, next) {
  if (req.body?.input) return next();
  if (typeof req.body?.context === "object" && req.body.context) {
    req.body = { input: { context: req.body.context } };
  } else if (typeof req.body?.context === "string") {
    req.body = { input: { context: { mode: req.body.context } } };
  } else {
    req.body = { input: {} };
  }
  next();
}

async function fetchInternalContext(endpointPath) {
  const port = process.env.PORT || 3000;
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${port}${endpointPath}`, {}, 5_000);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`AI brief context error for ${endpointPath}:`, error?.message || error);
    return null;
  }
}

router.post("/api/ai/route", normalizeAiRouteBody, validateBody(validateAiRouteBody), async (req, res) => {
  if (!process.env.GEMINI_API_KEY) { res.status(501).json({ error: "AI not configured" }); return; }

  const text = req.body.input.text.trim();
  const cacheKey = text.toLowerCase();
  const cached = getCached(aiRouteCache, cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const prompt = [
      "You classify wall-dashboard commands.",
      "Valid intents: switch_view, show_weather, show_cameras, show_calendar, status_explain, unknown.",
      "If user asks for a specific view, set intent=switch_view and set view.",
      "Valid view values: home, weather, cameras, calendar, agenda, status, briefing.",
      `Input: ${text}`
    ].join("\n");

    const parsed = await callGeminiJson({
      prompt,
      schemaExample: JSON.stringify(fallbackAiRoute()),
      timeoutMs: 10_000
    });
    const payload = parsed ? coerceAiRoute(parsed) : fallbackAiRoute();
    const validated = validateData(validateAiRouteResult, payload);
    const safePayload = validated.ok ? payload : fallbackAiRoute();
    if (!validated.ok) console.error("AI route outbound validation failed:", validated.errors);
    setCached(aiRouteCache, cacheKey, safePayload, 30_000);
    res.json(safePayload);
  } catch (error) {
    console.error("AI route error:", error?.message || error, error?.detail || "");
    res.json(fallbackAiRoute());
  }
});

router.post("/api/ai/brief", normalizeAiBriefBody, validateBody(validateAiBriefBody), async (req, res) => {
  if (!process.env.GEMINI_API_KEY) { res.status(501).json({ error: "AI not configured" }); return; }

  const mode = typeof req.body?.input?.context?.mode === "string"
    ? req.body.input.context.mode : "default";
  const cacheKey = mode.toLowerCase();
  const cached = getCached(aiBriefCache, cacheKey);
  if (cached) { res.json(cached); return; }

  const [calendar, metrics, ping, haHealth, cameras] = await Promise.all([
    fetchInternalContext("/api/calendar/all"),
    fetchInternalContext("/api/system/metrics"),
    fetchInternalContext("/api/system/ping"),
    fetchInternalContext("/api/ha/health"),
    fetchInternalContext("/api/cameras")
  ]);

  const contextPayload = {
    mode,
    generated_at: new Date().toISOString(),
    calendar_count: Array.isArray(calendar) ? calendar.length : null,
    next_events: Array.isArray(calendar) ? calendar.slice(0, 4) : [],
    metrics,
    ping,
    ha_health: haHealth,
    cameras
  };

  const fallback = {
    generated_at: new Date().toISOString(),
    headline: mode === "system" ? "System summary unavailable." : "Morning summary unavailable.",
    sections: {
      weather: "Weather data unavailable.",
      calendar: "Calendar data unavailable.",
      home: "Home status data unavailable.",
      tasks: "Task data unavailable."
    }
  };

  try {
    const prompt = [
      "You generate a concise wall-dashboard summary.",
      "Return JSON with fields: generated_at, headline, sections.weather, sections.calendar, sections.home, sections.tasks.",
      "Each section max 1 sentence.",
      `Context JSON: ${JSON.stringify(contextPayload).slice(0, 5000)}`
    ].join("\n");

    const parsed = await callGeminiJson({
      prompt,
      schemaExample: JSON.stringify(fallback),
      timeoutMs: 10_000
    });
    const payload = {
      generated_at: parsed?.generated_at || new Date().toISOString(),
      headline: typeof parsed?.headline === "string" ? parsed.headline : fallback.headline,
      sections: {
        weather: parsed?.sections?.weather || fallback.sections.weather,
        calendar: parsed?.sections?.calendar || fallback.sections.calendar,
        home: parsed?.sections?.home || fallback.sections.home,
        tasks: parsed?.sections?.tasks || fallback.sections.tasks
      }
    };
    setCached(aiBriefCache, cacheKey, payload, 5 * 60_000);
    res.json(payload);
  } catch (error) {
    console.error("AI brief error:", error?.message || error, error?.detail || "");
    res.json(fallback);
  }
});

export default router;
