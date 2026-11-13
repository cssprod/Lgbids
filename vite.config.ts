import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./src/web', import.meta.url));
const outDir = fileURLToPath(new URL('./dist/web', import.meta.url));

// The web UI is a static bundle served by the Fastify server in production.
// In development Vite serves it and proxies API calls to the server.
export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir, emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 3000}`, changeOrigin: false } },
  },
});
