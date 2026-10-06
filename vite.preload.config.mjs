// @ts-check
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: { entry: 'src/preload/index.ts', formats: ['cjs'], fileName: () => 'preload.cjs' },
    rollupOptions: {
      external: ['electron'],
      // Forge builds the preload from rollup input and names it after the entry file (index); the main
      // process loads it as preload.cjs.
      output: { entryFileNames: 'preload.cjs' },
    },
  },
})
