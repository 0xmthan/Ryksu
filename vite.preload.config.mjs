import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: { entry: 'src/preload.js', formats: ['cjs'], fileName: () => 'preload.cjs' },
    rollupOptions: { external: ['electron'] },
  },
})
