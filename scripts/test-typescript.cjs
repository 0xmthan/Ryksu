// Loads the TypeScript tests and sources as CommonJS, compiled with the TypeScript compiler, so they run the
// same on Node 22 and newer without relying on Node's own type stripping (the test script turns that off).
const fs = require('node:fs')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
  })
  module._compile(outputText, filename)
}
