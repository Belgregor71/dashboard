import { Router } from 'express';

export function createHealthRoutes() {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });
  return router;
}
