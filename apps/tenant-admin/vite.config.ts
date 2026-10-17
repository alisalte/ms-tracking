import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const identityTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';
const fleetTarget = process.env.VITE_FLEET_PROXY_TARGET ?? 'http://localhost:3006';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5174,
    proxy: {
      '/api/v1/platform': { target: fleetTarget, changeOrigin: true },
      '/api': { target: identityTarget, changeOrigin: true },
    },
  },
  build: {
    sourcemap: true,
    assetsDir: 'static',
  },
});
