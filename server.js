console.log(">>> DASHBOARD SERVER LOADED <<<");

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import serveIndex from "serve-index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================================================================
   STATIC FILES
============================================================================ */

app.use(express.static(path.join(__dirname, "static")));
app.use("/photos", serveIndex(path.join(__dirname, "static", "photos"), { icons: true }));
app.use("/photos", express.static(path.join(__dirname, "static", "photos")));
app.use("/icons", express.static(path.join(__dirname, "static", "icons")));

/* ============================================================================
   ROOT → index.html
============================================================================ */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

/* ============================================================================
   CALENDAR PROXY — MERGED FEED (STRICT MATCH)
============================================================================ */

app.get("/api/calendar/all", async (req, res) => {
  try {
    const CAL_SVC = process.env.CALENDAR_SERVICE_URL || "http://localhost:5000";
    const r = await fetch(`${CAL_SVC}/calendar/all`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("Calendar ALL proxy error:", err);
    res.status(500).json({ error: "Calendar all error" });
  }
});

/* ============================================================================
   CALENDAR PROXY — INDIVIDUAL SOURCES (REGEX-PROTECTED)
============================================================================ */

const CALENDAR_ENDPOINTS = {
  google: "http://localhost:5000/calendar/google",
  apple: "http://localhost:5000/calendar/apple",
  tripit: "http://localhost:5000/calendar/tripit"
};

// IMPORTANT: prevent ":source" from matching "all"
app.get("/api/calendar/:source(google|apple|tripit)", async (req, res) => {
  const src = req.params.source;
  const url = CALENDAR_ENDPOINTS[src];

  try {
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("Calendar proxy error:", err);
    res.status(500).json({ error: "Calendar error" });
  }
});

/* ============================================================================
   COMMUTE PROXY
============================================================================ */

app.get("/api/commute", async (req, res) => {
  const origin = req.query.origin;
  const destination = req.query.destination;

  const url =
    `http://localhost:5000/commute?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("Commute proxy error:", err);
    res.status(500).json({ error: "Commute error" });
  }
});

app.get("/api/commute_map", async (req, res) => {
  const origin = req.query.origin;
  const destination = req.query.destination;

  const url =
    `http://localhost:5000/commute_map?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}`;

  try {
    const r = await fetch(url);
    const buffer = await r.arrayBuffer();
    res.type("image/png").send(Buffer.from(buffer));
  } catch (err) {
    console.error("Commute map proxy error:", err);
    res.status(500).json({ error: "Commute map error" });
  }
});

/* ============================================================================
   START SERVER
============================================================================ */

app.listen(PORT, () => {
  console.log(`Dashboard listening on http://localhost:${PORT}`);
});
