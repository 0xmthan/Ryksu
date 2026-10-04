const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// The source checkout used by CI does not include the npm package's generated types.
const dataRoot = path.dirname(require.resolve('minecraft-data'))
const declarations = path.join(dataRoot, 'index.d.ts')

if (!fs.existsSync(declarations)) {
  const result = spawnSync(process.execPath, [path.join(dataRoot, 'typings/generate-typings.js')], {
    stdio: 'inherit',
  })
  // The upstream generator logs failures without setting a nonzero exit code.
  if (result.error || result.status !== 0 || !fs.existsSync(declarations)) {
    console.error('Failed to generate minecraft-data TypeScript declarations.', result.error ?? '')
    process.exit(1)
  }
}
