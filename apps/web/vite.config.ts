import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The API address can be overridden (the browser tests run their own API on another port).
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /**
     * Phase 4: installable app (EE-11, PWA requirement). The service worker keeps only the app's own files
     * (HTML, scripts, styles, icons) so it opens without a connection. API responses are never cached by it:
     * personal data offline lives only in the trainer's limited IndexedDB store (TR-09).
     * A new version waits until the user chooses to reload (see components/UpdatePrompt.tsx).
     */
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'VTA Talent Cloud',
        short_name: 'VTA',
        description: 'Training, attendance, assessments and certificates for automotive technicians.',
        start_url: '/login', // installed app opens to sign-in (signed-in people go on to their portal), not the public home
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#B5121B',
        background_color: '#FFFFFF',
        lang: 'en-IN',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Libraries change less often than app code, so phones re-download less after an update.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router', '@tanstack/react-query'],
          zod: ['zod'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // The browser talks to the API on the same origin, so cookies stay first-party and SameSite=Lax works.
    proxy: { '/api': apiTarget },
  },
  preview: {
    port: 4173,
    proxy: { '/api': apiTarget },
  },
});
