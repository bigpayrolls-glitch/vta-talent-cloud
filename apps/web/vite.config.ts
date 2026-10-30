import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import securityHeaders from './security-headers.json' with { type: 'json' };

/** Phase 10: the same headers the hosted site sends, so browser tests run under the real Content Security Policy. */
const headers = Object.fromEntries(Object.entries(securityHeaders).filter(([k]) => k !== '//'));

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
      includeAssets: ['favicon.svg', 'icons/atg-apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'AutoTalent Grid',
        short_name: 'AutoTalent',
        description: 'Train. Connect. Employ. Training, certificates and jobs for automotive technicians.',
        start_url: '/login', // installed app opens to sign-in (signed-in people go on to their portal), not the public home
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#B5121B',
        background_color: '#FFFFFF',
        lang: 'en-IN',
        icons: [
          { src: '/icons/atg-icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/atg-icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/atg-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Language files are not downloaded in advance: each phone keeps only the language it uses (cached below).
        globIgnores: ['**/assets/{hi,kn,ta,te,ml,mr,bn,gu}-*.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /^\/assets\/(hi|kn|ta|te|ml|mr|bn|gu)-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'site-languages', expiration: { maxEntries: 20 } },
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // Fonts stay as files: the Content Security Policy allows fonts from this site only, not data: URLs.
    assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
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
    headers,
  },
});
