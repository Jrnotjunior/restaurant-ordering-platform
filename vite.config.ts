import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isHostingerBuild = process.env.VITE_DEPLOY_TARGET === 'hostinger';

export default defineConfig({
  plugins: [react()],
  // Hostinger serves the compiled site from the domain root. GitHub Pages needs
  // the repository subpath. Keep the production targets explicit.
  base: isHostingerBuild ? '/' : process.env.GITHUB_ACTIONS === 'true' ? '/restaurant-ordering-platform/' : '/',
});
