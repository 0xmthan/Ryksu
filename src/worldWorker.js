// Builds the 3D view's block payload off the main thread (src/bot/worldCompute.js), so the bot's physics
// ticks, which run on the main thread, never wait on it. Built as its own file next to main.cjs.
const { parentPort } = require('node:worker_threads')
const { computeBlocks } = require('./bot/worldCompute')

parentPort.on('message', ({ id, input }) => {
  const data = computeBlocks(input)
  parentPort.postMessage({ id, data }, [data.light.cells.buffer])
})
