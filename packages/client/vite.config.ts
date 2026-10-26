import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Listen on the LAN so the iPhone can open the dev server.
    host: true,
    port: 5180,
    strictPort: true,
    // In dev, the Worker runs separately under `wrangler dev`.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  preview: { host: true, port: 5180, strictPort: true },
});
