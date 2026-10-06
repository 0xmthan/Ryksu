// Builds the 3D view's block payload off the main thread (src/main/bot/world/worldCompute.ts), so the bot's physics
// ticks, which run on the main thread, never wait on it. Built as its own file next to main.cjs.
import { parentPort } from 'node:worker_threads'
import { computeBlocks, type ComputeInput } from './worldCompute'

parentPort?.on('message', ({ id, input }: { id: number; input: ComputeInput }) => {
  const data = computeBlocks(input)
  parentPort?.postMessage({ id, data }, [data.light.cells.buffer as ArrayBuffer])
})
