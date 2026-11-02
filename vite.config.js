import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// GitHub Pages serves the app from /<repository>/ (the repository was renamed from cautious-palm-tree)
const BASE = '/achievement/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      base: BASE,
      manifest: {
        name: '업적 라이브러리',
        short_name: '업적',
        description: '꾸준히 하고 싶은 일을 기록하면 업적이 저절로 쌓이는 개인 기록장',
        lang: 'ko',
        theme_color: '#F6F5F1',
        background_color: '#F6F5F1',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${BASE}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: `${BASE}index.html`,
        navigateFallbackAllowlist: [new RegExp(`^${BASE}`)],
        // The Life Hub callback page is its own document, never the app shell.
        navigateFallbackDenylist: [new RegExp(`^${BASE}lifehub/`)],
        runtimeCaching: [
          {
            // Pretendard web font: cache the stylesheet and the subsets actually used.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pretendard-font',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
