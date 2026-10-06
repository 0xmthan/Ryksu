import { defineConfig } from 'vite'

// The world view worker (src/worldWorker.ts), built next to main.cjs. Everything it needs is bundled in.
export default defineConfig({
  build: {
    lib: { entry: 'src/worldWorker.ts', formats: ['cjs'], fileName: () => 'worldWorker.cjs' },
    rollupOptions: { external: [/^node:/] },
  },
})
