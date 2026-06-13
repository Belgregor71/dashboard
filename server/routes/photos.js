import express from "express";
import { readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.get("/api/photos", async (_req, res) => {
  const photosDir = path.join(__dirname, "..", "..", "static", "photos");
  const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);

  try {
    const entries = await readdir(photosDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => imageExtensions.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
    res.json(files);
  } catch (err) {
    if (err?.code === "ENOENT") { res.json([]); return; }
    console.error("Photo listing error:", err);
    res.status(500).json({ error: "Unable to list photos" });
  }
});

export default router;
