import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { BRAND_LOGO_URL } from './src/utils/branding.js';




export default defineConfig(({ mode }) => {
  const workspaceRoot = path.resolve(__dirname, '..');
  const sharedDevEnvPath = path.join(workspaceRoot, '.env.dev');

  // Support the repo's existing ".env.dev" naming convention for frontend too.
  if (mode === 'development' && fs.existsSync(sharedDevEnvPath)) {
    dotenv.config({ path: sharedDevEnvPath });
  }

  const publicBaseUrl = String(
    process.env.APP_BASE_URL
    || process.env.PUBLIC_BASE_URL
    || process.env.APP_URL
    || process.env.URL
    || ''
  ).trim().replace(/\/+$/, '');

  return {
    envDir: workspaceRoot,
    define: {
      __APP_BASE_URL__: JSON.stringify(publicBaseUrl)
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = String(id || '');
            if (normalized.includes('node_modules/react') || normalized.includes('node_modules/scheduler')) {
              return 'react-vendor';
            }
            if (normalized.includes('node_modules/react-router')) {
              return 'router-vendor';
            }
            if (normalized.includes('node_modules/lucide-react')) {
              return 'icons-vendor';
            }
            if (normalized.includes('node_modules/firebase')) {
              return 'firebase-vendor';
            }
            if (normalized.includes('/src/pages/admin/')) {
              return 'admin-pages';
            }
            return undefined;
          }
        }
      }
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'SSC Impon Jewellery',      // <--- Fixed Full Name
          short_name: 'SSC Impon',          // <--- Fixed App Name (Home Screen)
          description: 'SSC Impon Jewellery Store App',
          theme_color: '#D4AF37',           // <--- Matched your Gold theme
          background_color: '#ffffff',
          display: 'standalone',            // <--- Forces "App" mode (no URL bar)
          start_url: '/',                   // <--- Ensures it opens the homepage
          orientation: 'portrait',
          icons: [
            {
              src: BRAND_LOGO_URL,
              sizes: '192x192',
              type: 'image/webp',
              purpose: 'any maskable'
            },
            {
              src: BRAND_LOGO_URL,
              sizes: '512x512',
              type: 'image/webp',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          // This ensures the SW cleans up old files aggressively
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          // 3. Ensure the index.html is never cached blindly
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [
            /^\/api/,
            /^\/sitemap\.xml$/i,
            /^\/robots\.txt$/i,
            /\/[^/?]+\.(xml|txt)$/i
          ], // Don't route crawl/static docs through the SPA shell
        }
      })
    ],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/branding': {
          target: 'http://localhost:5000',
          changeOrigin: true
        }
      },
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: 5173,
        clientPort: 5173
      },
      // [ROOT CAUSE FIX] Explicitly disable isolation
      headers: {
        "Cross-Origin-Opener-Policy": "unsafe-none",
        "Cross-Origin-Embedder-Policy": "unsafe-none"
      }
    }
  };
});
