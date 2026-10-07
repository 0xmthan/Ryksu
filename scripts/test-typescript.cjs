// Loads the TypeScript tests and sources as CommonJS, compiled with the TypeScript compiler, so they run the
// same on Node 22 and newer without relying on Node's own type stripping (the test script turns that off).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

// Saves go to a throwaway folder, never the user's ~/.ryksu (each test file runs in its own process).
process.env.RYKSU_HOME ??= fs.mkdtempSync(path.join(os.tmpdir(), 'ryksu-test-'))

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
