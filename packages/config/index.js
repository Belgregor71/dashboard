export const appConfig = {
  port: Number(process.env.PORT || 3000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 5000),
  wsPath: '/ws'
};
