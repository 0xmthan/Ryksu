import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: 'src',
  base: './',
  build: { outDir: fileURLToPath(new URL('./.vite/renderer/main_window', import.meta.url)) },
  css: { postcss: fileURLToPath(new URL('.', import.meta.url)) },
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1' },
})
