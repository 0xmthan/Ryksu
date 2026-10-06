// @ts-check
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

// Keep runtime packages external so their data files and native modules are
// resolved from the packaged node_modules rather than a browser bundle.
const externalPackages = ['electron', ...Object.keys(pkg.dependencies)]

export default defineConfig({
  build: {
    lib: { entry: 'src/main.ts', formats: ['cjs'], fileName: () => 'main.cjs' },
    rollupOptions: {
      external: externalPackages.map((name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/|$)`)),
    },
  },
})
