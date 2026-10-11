import { defineConfig } from 'vite';

export default defineConfig({
  // Relativní cesty, aby aplikace fungovala na https://<uzivatel>.github.io/polohy/
  base: './',
  build: {
    // MapLibre je sám o sobě kolem 1 MB, varování o velikosti nepotřebujeme.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
    // Při lokálním vývoji obcházíme CORS přes dev server Vite.
    proxy: {
      '/dszo': {
        target: 'https://www.dszo.cz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dszo/, ''),
      },
    },
  },
});
