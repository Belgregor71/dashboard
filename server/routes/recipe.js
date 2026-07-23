import express from "express";
import { readFile, readdir, stat, writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { reportFailure, reportSuccess } from "../services/healthService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Recipes are stable — once a dish is searched + scraped, it's cached forever
// so the same dinner never costs another web search (the "search once" wishlist).
// data/recipe-cache/<slug>.json, mirroring the holiday-cache pattern in calendar.js.
const RECIPE_CACHE_DIR = path.join(__dirname, "..", "..", "data", "recipe-cache");

const router = express.Router();

// Empty-shape body so a failure keeps the same JSON contract the client parses.
const NULL_RECIPE = { title: null, ingredients: [], steps: [] };

// Haiku is the wired-in model and supports the basic web-search tool variant
// (web_search_20250305); the _20260209 dynamic-filtering variant needs Opus/
// Sonnet-tier. One web search per dish, cached — cost is a few cents per NEW dish.
const RECIPE_MODEL = process.env.RECIPE_MODEL ?? "claude-haiku-4-5";

const RECIPE_SYSTEM = [
  "You look up cooking recipes for a household dashboard.",
  "Search the web for the dish named by the user, choose ONE reputable recipe, and return it.",
  "Reply with ONLY a JSON object, no prose, no markdown fences:",
  '{ "title": string, "servings": string (optional), "ingredients": string[], "steps": string[] }',
  "Ingredients: one item per entry, with quantities (e.g. '400g spaghetti').",
  "Steps: short imperative sentences, one action per entry, in order.",
  "Keep it to a home-cook recipe — do not invent quantities you did not find.",
].join(" ");

function slugFor(dish) {
  if (dish == null) return "";
  return String(dish)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValidRecipe(obj) {
  return (
    obj &&
    typeof obj.title === "string" &&
    obj.title.trim() !== "" &&
    Array.isArray(obj.ingredients) &&
    obj.ingredients.length > 0 &&
    Array.isArray(obj.steps) &&
    obj.steps.length > 0
  );
}

async function readRecipeCache(slug) {
  try {
    const filePath = path.join(RECIPE_CACHE_DIR, `${slug}.json`);
    await stat(filePath);
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return isValidRecipe(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeRecipeCache(slug, recipe) {
  try {
    await mkdir(RECIPE_CACHE_DIR, { recursive: true });
    const filePath = path.join(RECIPE_CACHE_DIR, `${slug}.json`);
    await writeFile(filePath, JSON.stringify(recipe), "utf8");
  } catch (error) {
    console.warn("Unable to write recipe cache", error.message);
  }
}

let anthropic = null;
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 30_000,
    });
  }
  return anthropic;
}

// The model may wrap the JSON in prose or a ```json fence despite instructions —
// pull the last text block and extract the outermost {...}.
function parseRecipeFromMessage(msg) {
  const texts = (msg?.content ?? []).filter((b) => b.type === "text").map((b) => b.text);
  const raw = texts.reverse().find((t) => t && t.includes("{"));
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function searchRecipe(dish) {
  const client = getAnthropic();
  if (!client) return null;

  const params = {
    model: RECIPE_MODEL,
    max_tokens: 2000,
    system: RECIPE_SYSTEM,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    messages: [{ role: "user", content: `Recipe for: ${dish}` }],
  };

  let msg = await client.messages.create(params);
  // Server-tool loop can pause after 10 iterations; resume once, then bail.
  if (msg.stop_reason === "pause_turn") {
    msg = await client.messages.create({
      ...params,
      messages: [
        ...params.messages,
        { role: "assistant", content: msg.content },
      ],
    });
  }

  const recipe = parseRecipeFromMessage(msg);
  return isValidRecipe(recipe) ? recipe : null;
}

router.get("/api/recipe", async (req, res) => {
  const dish = String(req.query.dish ?? "").trim();
  if (!dish || dish.length > 120) {
    return res.status(400).json({ ...NULL_RECIPE, error: "dish query param required" });
  }

  const slug = slugFor(dish);
  if (!slug) {
    return res.status(400).json({ ...NULL_RECIPE, error: "dish must contain letters or numbers" });
  }

  const cached = await readRecipeCache(slug);
  if (cached) {
    return res.json({ ...cached, source: "cache", cached: true });
  }

  try {
    const recipe = await searchRecipe(dish);
    if (recipe) {
      await writeRecipeCache(slug, recipe);
      reportSuccess("ai");
      return res.json({ ...recipe, source: "claude", cached: false });
    }
  } catch (err) {
    console.error("[recipe] search error:", err.message);
    reportFailure("ai", err.message);
    return res.status(502).json({ ...NULL_RECIPE });
  }

  // No key (getAnthropic null) or unparseable result, and nothing cached.
  return res.status(502).json({ ...NULL_RECIPE });
});

// ── Recipe portal (static/recipes/) ───────────────────────────
// A LAN authoring page so the household can hand-add recipes and browse the
// cache, mirroring the Memory Studio (static/memories/). Authored recipes are
// written into the SAME recipe-cache with an `authored: true` marker, so a
// hand-added dish is found for free by GET /api/recipe when its Meal: event
// fires — no web search, no spend. The marker is an extra field the panel and
// isValidRecipe ignore.

const SLUG_RE = /^[a-z0-9-]+$/;
const MAX_ITEMS = 60;      // ingredients or steps
const MAX_ITEM_LEN = 300;  // one ingredient/step line

// Turn a portal payload into a valid recipe, or { error }. Kept strict: it is
// written to disk and read back by the dinner panel, so a bad shape is rejected
// here, not discovered on the glass.
function sanitizeAuthoredRecipe(body) {
  if (!body || typeof body !== "object") return { error: "body must be an object" };

  const title = String(body.title || "").trim();
  if (!title || title.length > 120) return { error: "title is required (1–120 chars)" };

  const slug = slugFor(body.slug || title);
  if (!slug) return { error: "title must contain letters or numbers" };

  const clean = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((s) => String(s ?? "").trim().slice(0, MAX_ITEM_LEN))
      .filter(Boolean)
      .slice(0, MAX_ITEMS);

  const ingredients = clean(body.ingredients);
  const steps = clean(body.steps);
  if (ingredients.length === 0) return { error: "at least one ingredient is required" };
  if (steps.length === 0) return { error: "at least one step is required" };

  const recipe = { title, ingredients, steps, authored: true };
  const servings = String(body.servings ?? "").trim();
  if (servings) recipe.servings = servings.slice(0, 40);

  return { slug, recipe };
}

// List every cached recipe (authored + AI-scraped) for the portal.
router.get("/api/recipes", async (_req, res) => {
  let files = [];
  try {
    files = (await readdir(RECIPE_CACHE_DIR)).filter((f) => f.toLowerCase().endsWith(".json"));
  } catch {
    return res.json({ recipes: [] }); // no cache dir yet — cold start
  }

  const recipes = [];
  for (const file of files) {
    const slug = file.replace(/\.json$/i, "");
    const parsed = await readRecipeCache(slug);
    if (!parsed) continue; // skip anything malformed/invalid
    recipes.push({
      slug,
      title: parsed.title,
      servings: parsed.servings ?? "",
      ingredients: parsed.ingredients,
      steps: parsed.steps,
      authored: parsed.authored === true,
    });
  }
  recipes.sort((a, b) => a.title.localeCompare(b.title));
  res.json({ recipes });
});

router.post("/api/recipe", async (req, res) => {
  const { slug, recipe, error } = sanitizeAuthoredRecipe(req.body);
  if (error) return res.status(400).json({ error });

  try {
    await writeRecipeCache(slug, recipe); // upsert by slug
    return res.json({ ok: true, slug, recipe });
  } catch {
    return res.status(500).json({ error: "could not save the recipe" });
  }
});

router.delete("/api/recipe/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: "invalid slug" });

  try {
    await unlink(path.join(RECIPE_CACHE_DIR, `${slug}.json`));
    return res.json({ ok: true, slug });
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "no recipe with that slug" });
    return res.status(500).json({ error: "could not delete the recipe" });
  }
});

export default router;
