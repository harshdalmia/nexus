import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  ssr: {
    /* dagre publishes an .esm.js without a module type, so Node mis-parses it
       when externalised. Bundling it keeps server-side render checks working. */
    noExternal: ['@dagrejs/dagre'],
  },
  build: {
    /* three.js ships in its own lazily-loaded chunk (the entity graph), so the
       default 500 kB warning is expected rather than a problem to fix */
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    open: true,
  },
});
