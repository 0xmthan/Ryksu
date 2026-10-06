// @ts-check
import { defineConfig } from 'vite'

// The world view worker (src/main/bot/world/worker.ts), built next to main.cjs. Everything it needs is bundled in.
export default defineConfig({
  build: {
    lib: { entry: 'src/main/bot/world/worker.ts', formats: ['cjs'], fileName: () => 'worldWorker.cjs' },
    rollupOptions: { external: [/^node:/] },
  },
})
