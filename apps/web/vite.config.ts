import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
const apiTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001';
export default defineConfig({
  plugins: [react()],
  // Concurrent demo/review servers have different proxies and dependency hashes.
  cacheDir: `node_modules/.vite-${createHash('sha256').update(apiTarget).digest('hex').slice(0, 12)}`,
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/socket.io': { target: apiTarget, ws: true, changeOrigin: true },
    },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
