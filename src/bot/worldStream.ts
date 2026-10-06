// Keeps the watcher's world view (inventory and the blocks around the bot) up to date: notes which blocks and
// chunks change, reads just those again (see readSlice in worldView.ts), has the block payload built off
// the main thread in a worker (src/worldWorker.ts), and sends the view whenever it changed.
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'
import type { Vec3 } from 'vec3'
import type { WorldView } from '../types'
import { computeBlocks, type BlocksData, type ComputeInput } from './worldCompute'
import {
  computeInput,
  createWorldTracker,
  getWorldView,
  readSlice,
  setBlocksData,
  type WorldTracker,
} from './worldView'

const WORLD_INTERVAL_MS = 500
// How soon the 3D view is sent after a block changes (grouping a few together), and after chunks load.
const BLOCK_UPDATE_DELAY_MS = 16
const CHUNK_UPDATE_DELAY_MS = 150
// The render distances the settings offer (blocks out from the bot).
const MIN_RENDER_DISTANCE = 16
const MAX_RENDER_DISTANCE = 120

type WorldJob = { id: number; bot: Bot }
type BotListeners = {
  blockUpdate: (oldBlock: Block | null, block: Block) => void
  chunk: (point?: Vec3) => void
  respawn: () => void
}

export class WorldStream {
  private onWorld: (view: WorldView) => void
  private bot: Bot | null = null
  private tracker: WorldTracker | null = null
  private listeners: BotListeners | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private emitAt = 0
  // The render distance from the app's settings, kept for later connections too.
  private renderDistance: number | undefined
  private lastBlocksKey: string | undefined
  private lastInventory: string | null = null
  // The worker is started once and kept across connections.
  private worker: Worker | null = null
  private workerFailed = false
  private busy: WorldJob | null = null
  private pending: { bot: Bot; input: ComputeInput } | null = null
  private jobId = 0

  constructor({ onWorld }: { onWorld: (view: WorldView) => void }) {
    this.onWorld = onWorld
  }

  // A changed block is re-read on its own and sent right away (not on the next tick), so breaking and
  // placing show up as soon as the server confirms them. Chunks coming or going re-read just their
  // columns, batched since they arrive in bursts; a respawn (maybe in another dimension) reads it all again.
  attach(bot: Bot) {
    this.detach()
    this.bot = bot
    const tracker = (this.tracker = createWorldTracker(this.renderDistance))
    this.listeners = {
      blockUpdate: (_old, block) => {
        if (!block?.position) return
        const { x, y, z } = block.position
        tracker.changes.add(`${x},${y},${z}`)
        tracker.dirty = true
        this.scheduleEmit(BLOCK_UPDATE_DELAY_MS)
      },
      chunk: (point) => {
        if (point) tracker.chunks.add(`${Math.floor(point.x / 16)},${Math.floor(point.z / 16)}`)
        else tracker.fullDirty = true
        tracker.dirty = true
        this.scheduleEmit(CHUNK_UPDATE_DELAY_MS)
      },
      respawn: () => {
        tracker.fullDirty = true
        tracker.dirty = true
        this.scheduleEmit(CHUNK_UPDATE_DELAY_MS)
      },
    }
    bot.on('blockUpdate', this.listeners.blockUpdate)
    bot.on('chunkColumnLoad', this.listeners.chunk)
    bot.on('chunkColumnUnload', this.listeners.chunk)
    bot.on('respawn', this.listeners.respawn)
  }

  detach() {
    this.stop()
    if (this.bot && this.listeners) {
      this.bot.removeListener('blockUpdate', this.listeners.blockUpdate)
      this.bot.removeListener('chunkColumnLoad', this.listeners.chunk)
      this.bot.removeListener('chunkColumnUnload', this.listeners.chunk)
      this.bot.removeListener('respawn', this.listeners.respawn)
    }
    this.listeners = null
    this.bot = null
    this.tracker = null
    this.lastBlocksKey = undefined
    this.lastInventory = null
  }

  // Sends the view regularly once the bot is in the world; between those, changes schedule their own sends.
  start() {
    if (this.interval) clearInterval(this.interval)
    this.interval = setInterval(() => this.emitNow(), WORLD_INTERVAL_MS)
  }

  stop() {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = null
  }

  // The 3D view's render distance (blocks out from the bot), from the app's graphics settings. Kept for the
  // next connection too. A change reads the whole resized area again. False for an unsupported distance.
  setRenderDistance(blocks: unknown) {
    const radius = Math.round(Number(blocks))
    if (!Number.isFinite(radius) || radius < MIN_RENDER_DISTANCE || radius > MAX_RENDER_DISTANCE) return false
    this.renderDistance = radius
    const tracker = this.tracker
    if (tracker && tracker.radius !== radius) {
      tracker.radius = radius
      tracker.dirty = true
      this.scheduleEmit(0)
    }
    return true
  }

  getWorldView() {
    const tracker = this.tracker ?? createWorldTracker(this.renderDistance)
    return getWorldView(this.bot, tracker, { cachedBlocks: Boolean(this.startWorker()) })
  }

  // Reads what changed in the world (cheap, here) and has the payload built (in the worker).
  emitNow() {
    const bot = this.bot
    const tracker = this.tracker
    if (!bot?.entity || !bot.world || !tracker) return
    try {
      const slice = readSlice(bot, tracker)
      if (slice) {
        const input = computeInput(bot, slice)
        if (this.startWorker()) this.queueCompute(bot, input)
        else setBlocksData(tracker, computeBlocks(input))
      }
      this.send()
    } catch (error) {
      console.error('[WorldStream] Failed to build world view', error)
    }
  }

  // Sends the world view after `delay` ms, unless one is already on its way sooner.
  private scheduleEmit(delay: number) {
    if (this.emitTimer && this.emitAt <= Date.now() + delay) return
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitAt = Date.now() + delay
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emitNow()
    }, delay)
  }

  // The worker that builds the 3D view's payload, started once. Without it (tests, or if it fails to start)
  // the payload is built right here instead.
  private startWorker() {
    if (this.worker || this.workerFailed) return this.worker
    const file = path.join(__dirname, 'worldWorker.cjs')
    try {
      if (!fs.existsSync(file)) throw new Error('not built')
      const worker = new Worker(file)
      worker.on('message', (message) => this.onComputed(message))
      worker.on('error', (error) => {
        console.error('[WorldStream] World worker failed; building the view on the main thread', error)
        this.workerFailed = true
        this.worker = null
        this.busy = null
      })
      worker.unref()
      this.worker = worker
    } catch {
      this.workerFailed = true
    }
    return this.worker
  }

  // One job at a time; while one runs, only the newest waiting input is kept.
  private queueCompute(bot: Bot, input: ComputeInput) {
    if (this.busy) {
      this.pending = { bot, input }
      return
    }
    const id = ++this.jobId
    this.busy = { id, bot }
    const buffers = [input.grid, input.kinds, input.leafy, input.submerged, input.occludes].map(
      (array) => array.buffer as ArrayBuffer
    )
    this.worker!.postMessage({ id, input }, buffers)
  }

  private onComputed({ id, data }: { id: number; data: BlocksData }) {
    const job = this.busy
    this.busy = null
    if (this.bot && this.tracker && job?.id === id && job.bot === this.bot) {
      setBlocksData(this.tracker, data)
      this.send()
    }
    const pending = this.pending
    this.pending = null
    if (pending?.bot === this.bot && this.worker) this.queueCompute(pending.bot, pending.input)
  }

  // Sends the inventory and the latest built blocks when either changed.
  private send() {
    if (!this.tracker) return
    try {
      const view = getWorldView(this.bot, this.tracker, { cachedBlocks: true })
      if (!view) return
      const blocksKey = view.blocks?.key
      const inventory = JSON.stringify(view.inventory)
      if (blocksKey !== this.lastBlocksKey || inventory !== this.lastInventory) {
        this.lastBlocksKey = blocksKey
        this.lastInventory = inventory
        this.onWorld(view)
      }
    } catch (error) {
      console.error('[WorldStream] Failed to build world view', error)
    }
  }
}
