import express from "express";
import { loopbackOnly } from "../middleware/security.js";
import { getIndex, searchVault, MAX_NOTES_RETURNED } from "../services/vaultIndex.js";

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

export default router;
