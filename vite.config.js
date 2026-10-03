import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "src",
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    // One surface. The incumbent entry (src/index.html) was retired on
    // 2026-10-03 (docs/audit/INCUMBENT-RETIREMENT-2026-10-03.md); V3 still
    // builds to dist/v3/index.html, which is what server.js serves at `/`.
    rollupOptions: {
      input: {
        v3: resolve(__dirname, "src/v3/index.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/env.js": "http://localhost:3000",
      "/photos": "http://localhost:3000",
      "/icons": "http://localhost:3000",
    },
  },
});
