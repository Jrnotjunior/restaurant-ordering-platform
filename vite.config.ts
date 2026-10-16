import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Actions builds for the project Pages path; Hostinger serves from the domain root.
  base: process.env.GITHUB_ACTIONS === 'true' ? '/restaurant-ordering-platform/' : '/',
});
