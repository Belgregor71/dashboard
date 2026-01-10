import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

import serveIndex from "serve-index";

app.use("/photos", serveIndex(path.join(__dirname, "static", "photos"), { icons: true }));

// Static files
app.use("/static", express.static(path.join(__dirname, "static")));
app.use("/photos", express.static(path.join(__dirname, "static", "photos")));
app.use("/icons", express.static(path.join(__dirname, "static", "icons")));

// Root -> index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

/* ------------------------------------------------------------------
   Calendar proxy endpoints (replace with real ICS URLs later)
-------------------------------------------------------------------*/
const CALENDAR_ENDPOINTS = {
  google: "http://localhost:5000/calendar/google",
  apple: "http://localhost:5000/calendar/apple",
  tripit: "http://localhost:5000/calendar/tripit"
};

app.get("/api/calendar/:source", async (req, res) => {
  const src = req.params.source;
  const url = CALENDAR_ENDPOINTS[src];
  if (!url) {
    return res.status(400).send("Unknown calendar source");
  }
  try {
    const r = await fetch(url);
    const text = await r.text();
    res.type("text/calendar").send(text);
  } catch (err) {
    console.error("Calendar proxy error:", err);
    res.status(500).send("Calendar error");
  }
});

/* ------------------------------------------------------------------
   Commute proxy endpoints (assuming you already have a local service)
-------------------------------------------------------------------*/

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
    res.status(500).send("Commute map error");
  }
});

/* ------------------------------------------------------------------
   TODO: Reminders / Notes / Server status endpoints later
-------------------------------------------------------------------*/

app.listen(PORT, () => {
  console.log(`Dashboard listening on http://localhost:${PORT}`);
});
