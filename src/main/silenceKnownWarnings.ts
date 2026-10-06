// Imported first by main.ts. node-rsa (used by minecraft-protocol) still calls `new Buffer()`. Node hides that
// warning for code in node_modules, but bundlers may inline it into our own file, so drop just that one. (The
// bundler hoists external requires above this; that's fine, since those load from node_modules.)
const originalEmitWarning = process.emitWarning
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const code = typeof args[0] === 'object' ? (args[0] as { code?: string } | null)?.code : args[1]
  if (code === 'DEP0005') {
    return
  }
  return (originalEmitWarning as (...params: unknown[]) => void).call(process, warning, ...args)
}) as typeof process.emitWarning

const originalConsoleLog = console.log.bind(console)

console.log = (...args: unknown[]) => {
  const firstArg = typeof args[0] === 'string' ? args[0] : ''
  if (firstArg.startsWith('Chunk size is ') && firstArg.includes('partial packet')) {
    originalConsoleLog('[Protocol] Server/plugin compatibility issue while parsing a packet.')
    return
  }

  originalConsoleLog(...args)
}
