import { defineConfig } from 'vite'

// The world view worker (src/worldWorker.js), built next to main.cjs. Everything it needs is bundled in.
export default defineConfig({
  build: {
    lib: { entry: 'src/worldWorker.js', formats: ['cjs'], fileName: () => 'worldWorker.cjs' },
    rollupOptions: { external: [/^node:/] },
  },
})
