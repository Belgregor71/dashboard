import express from "express";
import { loopbackOnly } from "../middleware/security.js";
import { getIndex, searchVault, MAX_NOTES_RETURNED } from "../services/vaultIndex.js";
import { listMemories, forgetMemory, forgetAllMemories } from "../services/conversationLog.js";

// House knowledge base routes (docs/design/VAULT.md). Read-only by design: the
// vault's write path is Obsidian itself, so there is exactly one authority for
// note content and nothing here can conflict with it.
//
// Mounted only when VAULT_ENABLED=1 (server.js), so with the lane off these
// paths 404 like any unknown route.

const router = express.Router();

// Note CONTENT is loopback-gated: this is the household's own writing, and the
// only legitimate caller is the kiosk on the Pi — the same asymmetry the cost
// routes trade on (server/middleware/security.js).
router.get("/api/vault/search", loopbackOnly("The vault search endpoint"), (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.status(400).json({ error: "q is required" });

  const notes = searchVault(q, { max: MAX_NOTES_RETURNED });
  res.json({
    query: q,
    notes: notes.map((n) => ({ id: n.id, title: n.title, tags: n.tags, kind: n.kind, body: n.body }))
  });
});

// Counts only, never content — safe on the LAN, and the signal for "is the
// vault actually syncing to the Pi". A cold start (no vault dir yet) is a valid
// state, not an error: 0 notes and a null timestamp.
router.get("/api/vault/status", (_req, res) => {
  const { notes, indexedAt } = getIndex();
  res.json({ notes: notes.length, indexedAt });
});

/* ── What the house has remembered about us ─────────────────────────────────
   The vault's write path is Obsidian, with one exception: the consolidator
   (services/conversationLog.js) distils spoken exchanges into notes under
   `remembered/`. Those were written by a machine listening to a kitchen, so
   unlike the rest of the vault they get a read-and-delete surface.

   Loopback-gated like the search route — this is the household's own life read
   back to them, and more sensitive than anything they typed by hand.
─────────────────────────────────────────────────────────────────────────── */
router.get("/api/vault/memories", loopbackOnly("The memory list"), async (_req, res) => {
  try {
    res.json({ memories: await listMemories() });
  } catch (err) {
    console.error("[vault] listing memories failed:", err.message);
    res.status(500).json({ error: "could not list memories" });
  }
});

// DELETE before the :id route would shadow it; Express matches in order, and
// the bare path never matches the parameterised one, so this ordering is safe
// and the specific route still wins for a real id.
router.delete("/api/vault/memories", loopbackOnly("Forgetting memories"), async (_req, res) => {
  try {
    res.json({ forgotten: await forgetAllMemories() });
  } catch (err) {
    console.error("[vault] forgetting all memories failed:", err.message);
    res.status(500).json({ error: "could not forget" });
  }
});

router.delete("/api/vault/memories/:id", loopbackOnly("Forgetting a memory"), async (req, res) => {
  try {
    // false means it was already gone. That is the caller's desired end state,
    // so it is a 200 with forgotten:false rather than a 404 to handle.
    res.json({ forgotten: await forgetMemory(req.params.id) });
  } catch (err) {
    console.error("[vault] forgetting a memory failed:", err.message);
    res.status(500).json({ error: "could not forget" });
  }
});

export default router;
