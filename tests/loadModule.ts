import { createRequire } from 'node:module'
import path from 'node:path'

// Loads a source file with some of its imports swapped for test doubles. `fakes` maps an import specifier
// (as written in the file) to what it gets instead; other imports load as usual. The swap only lasts while
// the file loads, and the file is loaded fresh each time. `globals` are set on globalThis for the file
// (document, window, …) and stay set. Type the result with the module it stands for:
// loadModule<typeof import('../src/x')>('src/x.ts', …).
export const loadModule = <T>(file: string, fakes: Record<string, unknown> = {}, globals: object = {}): T => {
  Object.assign(globalThis, globals)
  const absolute = path.resolve(file)
  const requireFrom = createRequire(absolute)
  const { cache } = requireFrom
  const swapped = Object.entries(fakes).map(([specifier, exports]) => {
    const resolved = requireFrom.resolve(specifier)
    const previous = cache[resolved]
    cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module
    return { resolved, previous }
  })
  delete cache[absolute]
  try {
    return requireFrom(absolute) as T
  } finally {
    delete cache[absolute]
    for (const { resolved, previous } of swapped) {
      if (previous) cache[resolved] = previous
      else delete cache[resolved]
    }
  }
}
