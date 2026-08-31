import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/* `base` has to be known at build time because it is baked into every asset URL.
   Left unset it stays '/', which is right for a domain root or a container; a
   project-scoped host (GitHub Pages at /<repo>/) needs it set explicitly. */
const basePath = (raw: string | undefined): string => {
  const trimmed = (raw ?? '').trim();

  if (trimmed.length === 0 || trimmed === '/') {
    return '/';
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
};

export default defineConfig(({ mode }) => ({
  base: basePath(loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE_PATH),
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
  preview: {
    port: 4173,
  },
}));
