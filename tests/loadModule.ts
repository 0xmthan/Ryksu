import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

// Loads a source file in its own context with some of its imports swapped for test doubles. `fakes` maps an
// import specifier (as written in the file) to what it gets instead; other imports load as usual, relative
// to the file. `globals` are extra globals for the file (document, window, …). Type the result with the
// module it stands for: loadModule<typeof import('../src/x')>('src/x.ts', …).
export const loadModule = <T>(file: string, fakes: Record<string, unknown> = {}, globals: object = {}): T => {
  const absolute = path.resolve(file)
  const requireNext = createRequire(absolute)
  const exportsObject = {}
  const { outputText } = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
  })
  vm.runInNewContext(outputText, {
    exports: exportsObject,
    require: (name: string) => (name in fakes ? fakes[name] : requireNext(name)),
    ...globals,
  })
  return exportsObject as T
}
