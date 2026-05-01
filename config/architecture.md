# Monorepo Architecture

- `apps/backend`: Express API + WebSocket gateway + core composition root.
- `apps/frontend`: Preact SPA with lazy-loaded panels and Zustand global state.
- `packages/*`: shared config, types, utilities, and central event bus.
- `services/*`: self-contained domain services that emit events.

## Raspberry Pi optimizations

- Event bus is in-process (`EventEmitter`) to minimize overhead.
- Camera polling is throttled to prevent noisy event storms.
- Frontend stores only latest event per camera to reduce memory.
- Lazy-loaded panels keep initial JS payload small.
