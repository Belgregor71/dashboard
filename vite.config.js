import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(process.cwd(), 'apps/frontend'),
  publicDir: resolve(process.cwd(), 'public'),
  build: {
    outDir: resolve(process.cwd(), 'apps/frontend/dist'),
    emptyOutDir: true
  }
});
