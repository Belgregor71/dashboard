// Recipe Book — the household hand-adds recipes and browses the cache, instead
// of relying only on the AI web-search lookup. Talks only to the dashboard's own
// server. Vanilla, no build step: served straight from static/recipes/ so it can
// never affect the 24/7 kiosk bundle. Authored recipes land in the same
// recipe-cache the dinner panel reads, so a saved dish shows for free when its
// Meal: calendar event fires.

const $ = (id) => document.getElementById(id);

// slug we're currently editing (null = adding new). Set when a saved recipe is
// clicked, so Save upserts the same cache file instead of forking a new slug.
let editingSlug = null;

// ── toast ──────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// One item per non-blank line, both directions.
const linesToList = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);
const listToLines = (arr) => (Array.isArray(arr) ? arr.join("\n") : "");

// ── editor ─────────────────────────────────────────────────────
function clearEditor() {
  editingSlug = null;
  $("editingSlug").textContent = "";
  $("title").value = "";
  $("servings").value = "";
  $("ingredients").value = "";
  $("steps").value = "";
  $("save").textContent = "Save recipe";
}

function loadIntoEditor(r) {
  editingSlug = r.slug;
  $("editingSlug").textContent = `— editing “${r.title}”`;
  $("title").value = r.title || "";
  $("servings").value = r.servings || "";
  $("ingredients").value = listToLines(r.ingredients);
  $("steps").value = listToLines(r.steps);
  $("save").textContent = "Update recipe";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function save() {
  const title = $("title").value.trim();
  const ingredients = linesToList($("ingredients").value);
  const steps = linesToList($("steps").value);
  if (!title) return toast("Give the dish a name first.", true);
  if (ingredients.length === 0) return toast("Add at least one ingredient.", true);
  if (steps.length === 0) return toast("Add at least one step.", true);

  const payload = { title, servings: $("servings").value.trim(), ingredients, steps };
  if (editingSlug) payload.slug = editingSlug; // keep editing the same cache file

  const btn = $("save");
  btn.disabled = true;
  try {
    const res = await fetch("/api/recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "save failed");
    toast("Recipe saved.");
    clearEditor();
    loadRecipes();
  } catch (e) {
    toast(e.message || "Couldn't save.", true);
  } finally {
    btn.disabled = false;
  }
}

// ── saved list ─────────────────────────────────────────────────
async function loadRecipes() {
  const wrap = $("saved");
  let recipes = [];
  try {
    const res = await fetch("/api/recipes");
    const data = await res.json();
    recipes = Array.isArray(data.recipes) ? data.recipes : [];
  } catch { /* leave empty */ }

  $("savedCount").textContent = recipes.length ? `— ${recipes.length}` : "";
  if (recipes.length === 0) {
    wrap.innerHTML = '<div class="empty">No recipes yet. Add your first one above.</div>';
    return;
  }

  wrap.innerHTML = "";
  for (const r of recipes) {
    const row = document.createElement("div");
    row.className = "entry";
    const serves = r.servings ? (/serv/i.test(r.servings) ? r.servings : `Serves ${r.servings}`) : "";
    const kind = r.authored ? "added" : "auto";
    const bits = [`${r.ingredients.length} ingredients`, `${r.steps.length} steps`];
    if (serves) bits.unshift(serves);
    row.innerHTML = `
      <div class="meta">
        <b>${escapeHtml(r.title)}</b>
        <span class="badge${r.authored ? " authored" : ""}">${kind}</span>
        <small>${escapeHtml(bits.join(" · "))}</small>
      </div>
      <button class="danger" data-slug="${escapeHtml(r.slug)}">Remove</button>`;
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return; // let the remove button handle its own click
      loadIntoEditor(r);
    });
    row.querySelector("button").addEventListener("click", () => removeRecipe(r.slug, r.title));
    wrap.appendChild(row);
  }
}

async function removeRecipe(slug, title) {
  if (!confirm(`Remove "${title || slug}"?`)) return;
  try {
    const res = await fetch(`/api/recipe/${encodeURIComponent(slug)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "delete failed");
    toast("Removed.");
    if (editingSlug === slug) clearEditor();
    loadRecipes();
  } catch (e) {
    toast(e.message || "Couldn't remove.", true);
  }
}

// ── wire up ────────────────────────────────────────────────────
$("save").addEventListener("click", save);
$("cancel").addEventListener("click", clearEditor);
loadRecipes();
