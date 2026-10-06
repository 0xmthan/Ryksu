import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: { entry: 'src/preload.ts', formats: ['cjs'], fileName: () => 'preload.cjs' },
    rollupOptions: { external: ['electron'] },
  },
})
