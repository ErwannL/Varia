import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Aucune ressource externe : polices système, icônes SVG locales, pas de CDN (CDC §26, prompt §4.4).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@varia/i18n': fileURLToPath(new URL('../i18n/src/index.ts', import.meta.url)) },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2022' },
  server: { proxy: { '/api': 'http://127.0.0.1:4321', '/health': 'http://127.0.0.1:4321' } },
})
