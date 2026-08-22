import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dev proxy — routes each `/api/v1/*` prefix to the service that owns it, so
 * the browser talks to one origin (no CORS) exactly like the nginx deployment:
 *
 *   /api/v1/fleets | vehicles | devices | summary   → fleet-management (3006)
 *   /api/v1/positions | trips                      → gps-engine (3005; backend has NO /api/v1 prefix → stripped)
 *   /api/v1/tracking/devices                        → gps-engine /devices (prefix stripped)
 *   /api/v1/map | route | location                  → map-engine (3009; prefix stripped — Sprint F)
 *   /api/v1/notification/*                          → notification-service (3008)
 *   /api/v1/fleet/*                                 → fleet-service (3007; drivers/business trips)
 *   /api/*  (everything else: auth/iam/tenants)     → identity (3000)
 *
 * Key order matters — the most specific prefixes must precede the `/api` catch-all.
 * The WebSocket (Socket.IO, default :3001) connects DIRECTLY via VITE_GPS_WS_URL,
 * not through this proxy (see useRealtimeSocket / GPS_WS_CORS_ORIGIN).
 */
const fleetTarget = process.env.VITE_FLEET_API_PROXY_TARGET ?? 'http://localhost:3006';
const gpsTarget = process.env.VITE_GPS_API_PROXY_TARGET ?? 'http://localhost:3005';
const mapTarget = process.env.VITE_MAP_API_PROXY_TARGET ?? 'http://localhost:3009';
const notificationTarget =
  process.env.VITE_NOTIFICATION_API_PROXY_TARGET ?? 'http://localhost:3008';
const fleetServiceTarget = process.env.VITE_FLEET_SVC_API_PROXY_TARGET ?? 'http://localhost:3007';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Don't watch Playwright E2E artifacts (traces/reports churn + lock files
    // crash the dev-server watcher with EBUSY on Windows).
    watch: {
      ignored: ['**/e2e/.results/**', '**/playwright-report/**', '**/test-results/**'],
    },
    proxy: {
      '/api/v1/fleets': { target: fleetTarget, changeOrigin: true },
      '/api/v1/vehicles': { target: fleetTarget, changeOrigin: true },
      '/api/v1/devices': { target: fleetTarget, changeOrigin: true },
      '/api/v1/summary': { target: fleetTarget, changeOrigin: true },
      '/api/v1/positions': {
        target: gpsTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/v1/, ''),
      },
      '/api/v1/trips': {
        target: gpsTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/v1/, ''),
      },
      '/api/v1/tracking/devices': {
        target: gpsTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/v1\/tracking/, ''),
      },
      '/api/v1/map': {
        target: mapTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/v1/, ''),
      },
      '/api/v1/route': {
        target: mapTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/v1/, ''),
      },
      '/api/v1/reports': {
        // reporting-service controllers carry the FULL /api/v1 prefix
        // (notification-style) — no rewrite, pass through.
        target: process.env.VITE_REPORT_API_PROXY_TARGET ?? 'http://localhost:3011',
        changeOrigin: true,
      },
      '/api/v1/geofences': {
        target: mapTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/v1/, ''),
      },
      '/api/v1/location': {
        target: mapTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/v1/, ''),
      },
      '/api/v1/notification': { target: notificationTarget, changeOrigin: true },
      '/api/v1/fleet': { target: fleetServiceTarget, changeOrigin: true },
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Use "static" instead of the default "assets" so the SPA route /assets
    // (the Asset Management page) doesn't collide with the static-asset path.
    assetsDir: 'static',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-i18n': ['i18next', 'i18next-browser-languagedetector', 'react-i18next'],
          'vendor-mui': ['@emotion/cache', '@emotion/react', '@emotion/styled', '@mui/material'],
          'vendor-echarts': ['echarts', 'echarts-for-react'],
          'vendor-map': ['maplibre-gl', 'supercluster'],
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'vendor-utils': ['axios', 'socket.io-client', 'zustand', 'lucide-react'],
        },
      },
    },
  },
});
