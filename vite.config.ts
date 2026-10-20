import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isHostingerBuild = process.env.VITE_DEPLOY_TARGET === 'hostinger';

export default defineConfig({
  plugins: [react()],
  // Both the customer app and the separate central-map iframe are built from
  // one source tree. Mapbox runs only in maps.html, served from the platform
  // origin rather than each tenant's unrelated custom domain.
  base: isHostingerBuild ? '/' : process.env.GITHUB_ACTIONS === 'true' ? '/restaurant-ordering-platform/' : '/',
  build: {
    rollupOptions: {
      input: {
        app: resolve(process.cwd(), 'index.html'),
        maps: resolve(process.cwd(), 'maps.html'),
      },
    },
  },
});
