import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const localBackendProxy = {
  '/api': {
    target: 'http://localhost:5000',
    changeOrigin: true,
    secure: false,
  },
  '/socket.io': {
    target: 'http://localhost:5000',
    changeOrigin: true,
    ws: true,
    secure: false,
  },
  '/uploads': {
    target: 'http://localhost:5000',
    changeOrigin: true,
    secure: false,
  }
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      selfDestroying: true,
      includeAssets: ['pwa-192.png', 'pwa-512.png', 'apple-touch-icon.png', 'syncrova-app-logo.png'],
      manifest: {
        name: 'Syncrova',
        short_name: 'Syncrova',
        description: 'Syncrova workspace, messaging, reports, games, and team collaboration for NEMSU students.',
        theme_color: '#1877f2',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/syncrova-app-logo.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/syncrova-app-logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,woff2}'],
        globIgnores: ['**/game-assets/**', '**/lol-ranks/**', '**/*.{png,webp,jpg,jpeg,gif,mp3}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io'),
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    watch: {
      usePolling: true,
      interval: 1000,
      ignored: [
        '**/android/**',
        '**/ios/**',
        '**/dist/**',
        '**/build/**',
        '**/.gradle/**'
      ]
    },
    proxy: localBackendProxy
  },
  preview: {
    host: '0.0.0.0',
    proxy: localBackendProxy
  },
  build: {
    target: 'es2019',
    cssMinify: true,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) return 'vendor-react';
            if (id.includes('framer-motion')) return 'vendor-motion';
            if (id.includes('livekit-client')) return 'vendor-calls';
            if (id.includes('socket.io-client')) return 'vendor-realtime';
            if (id.includes('emoji-picker-react')) return 'vendor-emoji';
            if (id.includes('@capacitor')) return 'vendor-capacitor';
            if (id.includes('use-sound')) return 'vendor-audio';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('three')) return 'vendor-three';
            if (id.includes('date-fns')) return 'vendor-utils';
            return 'vendor';
          }
          return undefined;
        }
      }
    }
  }
})
