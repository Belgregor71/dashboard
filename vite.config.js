import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "src",
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    // Two independent surfaces from one server. `index` is the incumbent
    // dashboard; `v3` is the parallel rebuild, which shares every /api/* route
    // but no CSS, no tokens and no view system. The kiosk points at one URL or
    // the other, so switching between them — or rolling back — is a URL change
    // rather than a revert.
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/index.html"),
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
