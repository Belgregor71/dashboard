import { Router } from 'express';

export function createCameraRoutes(serviceRegistry) {
  const router = Router();
  router.post('/camera/poll', async (_req, res) => {
    await serviceRegistry.camera.poll();
    res.json({ ok: true });
  });
  return router;
}
