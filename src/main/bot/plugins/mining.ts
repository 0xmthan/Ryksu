import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'
import type { Entity } from 'prismarine-entity'
import type { Item } from 'prismarine-item'
import { Vec3 } from 'vec3'
import type { MiningState } from '../../../shared/types'
import { Movements, goals } from '../vendor/pathfinder'
import type { Goal } from '../vendor/pathfinder/lib/goals'
import type { AutoToolController } from './autoTool'
import { applyBlockEditing } from './blockEditing'
import { avoidBigCaves } from './caves'
import { type ChestStore, type SavedChest, fileChestStore } from './miningChests'
import {
  GoalReach,
  MAX_OBSTRUCTIONS,
  type SightLine,
  collectCluster,
  inReach,
  obstructions,
  isHostile,
  pickNext,
  seedScore,
} from './miningTargets'
import { type PathfinderController, watchStall } from './pathfinder'

type Alive = () => boolean
type DepositEntry = { type: number; name: string; count: number }
// One tree or ore vein. `groundY` is where the bot stood for its first block, so it knows how far to come
// back down once a tall tree is done.
type Cluster = { origin: Vec3; blocks: Vec3[]; groundY: number | null }
// What the miner is doing right now, so a fight can cut it short.
type Task = { kind: 'dig' } | { kind: 'path'; goal: Goal }

// Ore choices shown in the UI, each mapped to the block names that count as that ore.
export const ORE_BLOCKS: Record<string, string[]> = {
  coal: ['coal_ore', 'deepslate_coal_ore'],
  copper: ['copper_ore', 'deepslate_copper_ore'],
  iron: ['iron_ore', 'deepslate_iron_ore'],
  gold: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
  redstone: ['redstone_ore', 'deepslate_redstone_ore'],
  lapis: ['lapis_ore', 'deepslate_lapis_ore'],
  diamond: ['diamond_ore', 'deepslate_diamond_ore'],
  emerald: ['emerald_ore', 'deepslate_emerald_ore'],
  quartz: ['nether_quartz_ore'],
  debris: ['ancient_debris'],
}

// Searched outward in steps, so the common case (something close by) only scans a small area.
const SEARCH_RADII = [16, 32, 48]
const SEARCH_COUNT = 16
// Wanted blocks this close are checked for being in reach and in sight, so the bot never walks past one.
const NEARBY_RADIUS = 5
export const CHEST_NAMES = ['chest', 'trapped_chest', 'barrel']
// Head back to the chest once this few inventory slots are left.
const MIN_FREE_SLOTS = 3
// Picked blocks are capped so a typo-free but huge list can't flood findBlocks.
const MAX_CUSTOM_BLOCKS = 64
const DROP_PICKUP_RADIUS = 8
const MAX_DROP_PICKUPS = 8
const FAILED_BLOCK_COOLDOWN_MS = 60000
const IDLE_RETRY_MS = 5000
const PATH_TIMEOUT_MS = 20000
// Short, light searches: an unreachable block is skipped quickly instead of the planner hogging the
// main process for seconds while it looks for a way up a tree.
const THINK_TIMEOUT_MS = 3000
const TICK_TIMEOUT_MS = 15
// Standing still this long while walking somewhere means the pathfinder has stalled (it's longer than a search).
const IDLE_GIVE_UP_MS = 4000
// A breather between blocks, and after a tree or vein.
const BLOCK_PAUSE_MS = 150
const CLUSTER_PAUSE_MS = 500
// Fights: mobs this close (and in sight) get dealt with before mining carries on; once it's quiet the
// bot waits a moment before picking the pickaxe back up.
const THREAT_RADIUS = 10
const THREAT_VERTICAL = 5
const THREAT_POINT_BLANK = 3
const THREAT_GIVE_UP_MS = 20000
const WATCH_INTERVAL_MS = 250
const CALM_DOWN_MS = 1500
// Pathfinder scaffolds with these, so a stack stays in the inventory.
const SCAFFOLD_ITEMS = ['cobblestone', 'cobbled_deepslate', 'dirt', 'netherrack']
const SCAFFOLD_RESERVE = 64

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  // The losing promise still settles later; keep that from surfacing as an unhandled rejection.
  promise.catch(() => {})
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const posKey = (pos: Vec3) => `${pos.x},${pos.y},${pos.z}`

class Interrupted extends Error {}

export class MiningController {
  private pathfinder: PathfinderController
  private autoTool: AutoToolController
  private isBusy: () => boolean
  private defend: ((mob: Entity) => void) | undefined
  private onStop: ((reason: string, details: { automatic: boolean }) => void) | undefined
  private onUpdate: (() => void) | undefined
  private bot: Bot | null
  private running: boolean
  private runId: number
  private ores: string[]
  private blocks: string[]
  // Every loot chest picked on this server, in any dimension; `chests` is the ones in the bot's dimension.
  private savedChests: SavedChest[]
  private server: string | null
  private chestStore: ChestStore
  private mined: number
  private deposited: number
  private status: string
  private failedBlocks: Map<string, number>
  private movements: Movements | null
  private cluster: Cluster | null
  private task: Task | null
  private watcher: ReturnType<typeof setInterval> | null
  private threat: Entity | null
  // When each mob was first fought; one that can't be beaten or reached is ignored after a while.
  private engagedAt: Map<number, number>
  private calmUntil: number

  constructor({
    pathfinder,
    autoTool,
    isBusy,
    defend,
    chestStore,
    onStop,
    onUpdate,
  }: {
    pathfinder: PathfinderController
    autoTool: AutoToolController
    // Something else (a fight, fleeing a creeper) has the bot.
    isBusy?: () => boolean
    // Hands a mob closing in on the bot to the PvP plugin.
    defend?: (mob: Entity) => void
    chestStore?: ChestStore
    onStop?: (reason: string, details: { automatic: boolean }) => void
    onUpdate?: () => void
  }) {
    this.pathfinder = pathfinder
    this.autoTool = autoTool
    this.isBusy = isBusy ?? (() => false)
    this.defend = defend
    this.onStop = onStop
    this.onUpdate = onUpdate
    this.bot = null
    this.running = false
    this.runId = 0
    this.ores = []
    this.blocks = []
    // Chests picked by hand in the 3D view; loot only goes into these.
    this.savedChests = []
    this.server = null
    this.chestStore = chestStore ?? fileChestStore
    this.mined = 0
    this.deposited = 0
    this.status = 'Idle'
    this.failedBlocks = new Map()
    this.movements = null
    this.cluster = null
    this.task = null
    this.watcher = null
    this.threat = null
    this.engagedAt = new Map()
    this.calmUntil = 0
  }

  // The server the next bot joins ("host:port"), whose loot chests it remembers.
  setServer(server: string) {
    if (server === this.server) return
    this.server = server
    this.savedChests = this.chestStore.load(server)
  }

  attach(bot: Bot) {
    this.bot = bot
    this.movements = null
  }

  private _dimension() {
    return String(this.bot?.game?.dimension ?? 'overworld').replace(/^minecraft:/, '')
  }

  private get chests() {
    const dimension = this._dimension()
    return this.savedChests
      .filter((chest) => chest.dimension === dimension)
      .map(({ x, y, z }) => new Vec3(x, y, z))
  }

  detach() {
    this.running = false
    this.runId++
    this._stopWatching()
    this.bot = null
    this.movements = null
    this.status = 'Idle'
  }

  getState(): MiningState {
    return {
      active: this.running,
      ores: [...this.ores],
      blocks: [...this.blocks],
      chests: this.chests.map(({ x, y, z }) => ({ x, y, z })),
      mined: this.mined,
      deposited: this.deposited,
      status: this.status,
    }
  }

  // Every block the bot can break, for the block picker.
  getMineableBlocks() {
    const bot = this.bot
    if (!bot?.registry) {
      return []
    }
    return bot.registry.blocksArray
      .filter((block) => (block as { diggable?: boolean }).diggable)
      .map((block) => ({ name: block.name, displayName: block.displayName ?? block.name }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }

  // `ores` and `blocks` come from the renderer; anything unknown is dropped.
  start({ ores, blocks }: { ores?: unknown; blocks?: unknown } = {}) {
    const bot = this.bot
    if (!bot?.entity) {
      throw new Error('The bot is not in the world yet.')
    }
    if (this.running) {
      throw new Error('Already mining.')
    }

    const selectedOres = (Array.isArray(ores) ? (ores as string[]) : []).filter((ore) => ORE_BLOCKS[ore])
    const selectedBlocks = [...new Set<string>(Array.isArray(blocks) ? blocks : [])]
      .filter((name) => (bot.registry.blocksByName[name] as { diggable?: boolean } | undefined)?.diggable)
      .slice(0, MAX_CUSTOM_BLOCKS)
    if (selectedOres.length === 0 && selectedBlocks.length === 0) {
      throw new Error('Pick at least one ore or block to mine.')
    }

    this.ores = selectedOres
    this.blocks = selectedBlocks
    this.mined = 0
    this.deposited = 0
    this.failedBlocks.clear()
    this.engagedAt.clear()
    this.cluster = null
    this.threat = null
    this.calmUntil = 0
    this.running = true
    const runId = ++this.runId
    this._setStatus('Starting…')
    this._startWatching()
    this._loop(runId)
    return this.getState()
  }

  // Adds the chest at `position` to the deposit list, or removes it if it's already there.
  toggleChest(position: unknown) {
    const bot = this.bot
    if (!bot) {
      throw new Error('The bot is not connected.')
    }
    const { x, y, z } = (position ?? {}) as Record<'x' | 'y' | 'z', number>
    if (![x, y, z].every(Number.isInteger)) {
      throw new Error('Invalid block position.')
    }
    const dimension = this._dimension()
    const index = this.savedChests.findIndex(
      (chest) => chest.x === x && chest.y === y && chest.z === z && chest.dimension === dimension
    )
    if (index !== -1) {
      this.savedChests.splice(index, 1)
      this._saveChests()
      this.onUpdate?.()
      return { added: false, state: this.getState() }
    }
    const block = bot.blockAt(new Vec3(x, y, z))
    if (!block || !CHEST_NAMES.includes(block.name)) {
      throw new Error('Only chests, trapped chests and barrels can store loot.')
    }
    this.savedChests.push({ x, y, z, dimension })
    this._saveChests()
    this.onUpdate?.()
    return { added: true, state: this.getState() }
  }

  private _saveChests() {
    if (this.server) {
      this.chestStore.save(this.server, this.savedChests)
    }
  }

  // `automatic` is set when mining ends on its own (full inventory, missing tool, …) rather than on request.
  stop(reason = 'Stopped.', { automatic = false } = {}) {
    if (!this.running) {
      return this.getState()
    }
    this.running = false
    this.runId++
    this._stopWatching()
    this._interrupt()
    this.cluster = null
    this._setStatus(reason)
    this.onStop?.(reason, { automatic })
    return this.getState()
  }

  private async _loop(runId: number) {
    const alive = () => Boolean(this.running && this.runId === runId && this.bot)

    while (alive()) {
      try {
        if (this._inDanger()) {
          this._setStatus(
            this.threat
              ? `Fighting ${this._mobName(this.threat)}`
              : 'Paused (eating, fighting, fleeing or sleeping)'
          )
          this.calmUntil = Date.now() + CALM_DOWN_MS
          await sleep(WATCH_INTERVAL_MS)
          continue
        }
        if (Date.now() < this.calmUntil) {
          this._setStatus('All clear, getting back to mining')
          await sleep(WATCH_INTERVAL_MS)
          continue
        }

        const hasChest = this.chests.length > 0
        if (!hasChest && this._freeSlots() === 0) {
          throw new Error('STOP: Inventory is full.')
        }
        if (hasChest && this._freeSlots() < MIN_FREE_SLOTS) {
          await this._depositAll(alive)
          continue
        }

        // Anything wanted that's already in reach and in sight comes first, even outside the current job.
        const nearby = this._visibleTarget()
        if (nearby) {
          await this._mineBlock(nearby, this.cluster, alive)
          await sleep(BLOCK_PAUSE_MS)
          continue
        }

        if (!this.cluster) {
          this.cluster = this._findCluster()
          if (!this.cluster) {
            this._setStatus(`No ${this.describeTargets()} within ${SEARCH_RADII.at(-1)} blocks. Waiting…`)
            await sleep(IDLE_RETRY_MS)
            continue
          }
        }

        const cluster = this.cluster
        const target = this._nextInCluster(cluster)
        if (!target) {
          await this._finishCluster(cluster, alive)
          if (this.cluster === cluster) {
            this.cluster = null
          }
          await sleep(CLUSTER_PAUSE_MS)
          continue
        }

        await this._mineBlock(target, cluster, alive)
        await sleep(BLOCK_PAUSE_MS)
      } catch (error) {
        if (!alive()) {
          return
        }
        if (error instanceof Interrupted) {
          continue
        }
        const message = (error as Error | undefined)?.message ?? String(error)
        if (message.startsWith('STOP:')) {
          this.stop(message.slice(5).trim(), { automatic: true })
          return
        }
        console.error('[Mining] step failed', error)
        this._setStatus(`Retrying: ${message}`)
        await sleep(1000)
      }
    }
  }

  private async _mineBlock(position: Vec3, cluster: Cluster | null, alive: Alive) {
    const bot = this.bot!
    const block = bot.blockAt(position)
    if (!block) {
      return
    }
    const label = block.displayName ?? block.name
    const { x, y, z } = position

    const unsafe = this._unsafeReason(block)
    if (unsafe) {
      this._markFailed(position)
      this._setStatus(`Skipping ${label} at ${x} ${y} ${z}: ${unsafe}`)
      return
    }

    if (!inReach(this._sight(), bot.entity.position, position)) {
      const goal = new GoalReach(position, this._sight())
      if (!goal.isEnd(bot.entity.position.floored())) {
        this._setStatus(`Walking to ${label} at ${x} ${y} ${z}`)
        try {
          await this._goto(goal)
        } catch (error) {
          if (!(error instanceof Interrupted)) {
            this._markFailed(position)
          }
          throw error
        }
        if (!alive()) {
          return
        }
        if (!goal.isEnd(bot.entity.position.floored())) {
          this._markFailed(position)
          this._setStatus(`Couldn't get to ${label} at ${x} ${y} ${z}, skipping it for now`)
          return
        }
      }
      if (!(await this._clearSightTo(position, label))) {
        return
      }
    }

    // The block may have changed while walking (someone else mined it, gravel fell, …).
    const current = bot.blockAt(position)
    if (!current || current.type !== block.type) {
      return
    }

    const tool = await this._equipTool(current)
    if (!current.canHarvest(tool?.type ?? null)) {
      throw new Error(`STOP: The bot has no tool that can mine ${label}.`)
    }

    if (cluster) {
      cluster.groundY ??= Math.floor(bot.entity.position.y)
    }
    this._setStatus(`Mining ${label}`)
    try {
      await this._dig(current)
    } catch (error) {
      if (!(error instanceof Interrupted)) {
        this._markFailed(position)
      }
      throw error
    }
    this.mined++
  }

  // Digs the blocks between the bot and the target (stone in front of an ore, leaves around a log), so the
  // target itself is never mined through a wall.
  private async _clearSightTo(position: Vec3, label: string) {
    const bot = this.bot!
    for (let i = 0; i <= MAX_OBSTRUCTIONS; i++) {
      const blocking = obstructions(this._sight(), bot.entity.position.floored(), position)
      if (blocking?.length === 0) {
        return true
      }
      const block = blocking ? bot.blockAt(blocking[0]) : null
      if (
        !block ||
        !block.diggable ||
        this._unsafeReason(block) ||
        this.chests.some((chest) => chest.equals(block.position))
      ) {
        this._markFailed(position)
        return false
      }
      this._setStatus(`Digging through ${block.displayName ?? block.name} to reach ${label}`)
      await this._equipTool(block)
      try {
        await this._dig(block)
      } catch (error) {
        if (!(error instanceof Interrupted)) {
          this._markFailed(position)
        }
        throw error
      }
    }
    this._markFailed(position)
    return false
  }

  // Lava next to the block would pour onto the bot.
  private _unsafeReason(block: Block) {
    const bot = this.bot!
    const sides = [
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, -1, 0],
    ] as const
    for (const [dx, dy, dz] of sides) {
      const name = bot.blockAt(block.position.offset(dx, dy, dz))?.name
      if (name === 'lava' || name === 'flowing_lava') {
        return 'lava behind it'
      }
    }
    return null
  }

  private async _dig(block: Block) {
    const bot = this.bot!
    this.task = { kind: 'dig' }
    const task = this.task
    try {
      await withTimeout(bot.dig(block, true), bot.digTime(block) + 5000, 'Digging took too long.')
    } catch (error) {
      if (this.task !== task || this._inDanger()) {
        throw new Interrupted()
      }
      try {
        bot.stopDigging()
      } catch {
        // not digging
      }
      throw error
    } finally {
      if (this.task === task) {
        this.task = null
      }
    }
  }

  private async _equipTool(block: Block) {
    const bot = this.bot!
    if (this.autoTool && !bot.tool) {
      await this.autoTool.ensurePlugin()
    }
    if (bot.tool) {
      try {
        await bot.tool.equipForBlock(block, { requireHarvest: true })
      } catch {
        // No harvesting tool; canHarvest below reports it.
      }
    }
    return bot.heldItem
  }

  // A tree or vein is done: come down off any blocks the bot stacked to reach the top, then pick up drops.
  private async _finishCluster(cluster: Cluster, alive: Alive) {
    await this._climbDown(cluster, alive)
    if (alive()) {
      await this._collectDrops(cluster.origin, alive)
    }
  }

  // Digs out the scaffolding pillar under the bot, one block at a time, back to where it started.
  private async _climbDown(cluster: Cluster, alive: Alive) {
    const bot = this.bot!
    if (cluster.groundY === null) {
      return
    }
    for (let i = 0; i < 24 && alive() && !this._inDanger(); i++) {
      const feet = bot.entity.position.floored()
      if (feet.y <= cluster.groundY || !bot.entity.onGround) {
        return
      }
      const below = bot.blockAt(feet.offset(0, -1, 0))
      if (!below || !SCAFFOLD_ITEMS.includes(below.name)) {
        return
      }
      this._setStatus('Climbing back down')
      await this._equipTool(below)
      await this._dig(below)
      // Fall onto the next block before looking at it.
      for (let t = 0; t < 10 && alive() && bot.entity.position.y > feet.y - 0.5; t++) {
        await sleep(100)
      }
    }
  }

  private async _collectDrops(origin: Vec3, alive: Alive) {
    const bot = this.bot!
    const skipped = new Set<number>()
    await sleep(400)
    for (let i = 0; i < MAX_DROP_PICKUPS && alive() && !this._inDanger(); i++) {
      const position = bot.entity.position
      const drop = Object.values(bot.entities)
        .filter(
          (entity) =>
            entity?.name === 'item' &&
            entity.isValid &&
            !skipped.has(entity.id) &&
            Math.hypot(entity.position.x - origin.x, entity.position.z - origin.z) <= DROP_PICKUP_RADIUS &&
            Math.abs(entity.position.y - origin.y) <= 32
        )
        .sort((a, b) => a.position.distanceTo(position) - b.position.distanceTo(position))[0]
      if (!drop) {
        return
      }
      this._setStatus('Picking up drops')
      skipped.add(drop.id)
      const { x, y, z } = drop.position.floored()
      try {
        await this._goto(new goals.GoalNear(x, y, z, 1), 6000)
      } catch (error) {
        if (error instanceof Interrupted) {
          throw error
        }
        continue
      }
      await sleep(250)
    }
  }

  // Fills the picked chests nearest first, moving on when one is full or gone.
  private async _depositAll(alive: Alive) {
    const bot = this.bot!
    if (this.chests.length === 0) {
      throw new Error('STOP: No chest picked.')
    }
    if (this._depositPlan().length === 0) {
      throw new Error('STOP: Inventory is full of gear it keeps (tools, armor, food).')
    }

    const origin = bot.entity.position
    const queue = [...this.chests].sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin))
    for (const chest of queue) {
      if (!alive()) {
        return
      }
      const label = `${chest.x} ${chest.y} ${chest.z}`
      this._setStatus(`Inventory full, going to the chest at ${label}`)
      try {
        await this._goto(new goals.GoalGetToBlock(chest.x, chest.y, chest.z))
      } catch (error) {
        console.error(`[Mining] could not reach the chest at ${label}`, error)
        continue
      }
      if (!alive()) {
        return
      }

      const chestBlock = bot.blockAt(chest)
      if (!chestBlock || !CHEST_NAMES.includes(chestBlock.name)) {
        continue
      }

      this._setStatus(`Putting items in the chest at ${label}`)
      if (await this._depositInto(chestBlock, alive)) {
        return
      }
    }
    throw new Error(
      this.chests.length === 1
        ? 'STOP: The chest is full or unreachable.'
        : 'STOP: All picked chests are full or unreachable.'
    )
  }

  // True once everything that should go is stored; false if this chest filled up first.
  private async _depositInto(chestBlock: Block, alive: Alive) {
    const container = await this.bot!.openContainer(chestBlock)
    try {
      for (const { type, count, name } of this._depositPlan()) {
        if (!alive()) {
          return true
        }
        try {
          await container.deposit(type, null, count)
          this.deposited += count
        } catch (error) {
          if (/full/i.test((error as Error | undefined)?.message ?? '')) {
            return false
          }
          console.error(`[Mining] could not deposit ${name}`, error)
        }
      }
      return true
    } finally {
      container.close()
    }
  }

  // Everything except gear, food, and a stack of scaffolding blocks.
  private _depositPlan() {
    const bot = this.bot!
    const totals = new Map<number, DepositEntry>()
    for (const item of bot.inventory.items()) {
      if (this._shouldKeep(item)) {
        continue
      }
      const entry = totals.get(item.type) ?? { type: item.type, name: item.name, count: 0 }
      entry.count += item.count
      totals.set(item.type, entry)
    }

    const plan: DepositEntry[] = []
    for (const entry of totals.values()) {
      if (SCAFFOLD_ITEMS.includes(entry.name)) {
        entry.count -= SCAFFOLD_RESERVE
      }
      if (entry.count > 0) {
        plan.push(entry)
      }
    }
    return plan
  }

  private _shouldKeep(item: Item) {
    const name = item.name
    return (
      /_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$/.test(name) ||
      [
        'shield',
        'bow',
        'crossbow',
        'trident',
        'mace',
        'torch',
        'elytra',
        'shears',
        'flint_and_steel',
      ].includes(name) ||
      name.endsWith('_bed') ||
      Boolean(this.bot!.registry.foodsByName?.[name])
    )
  }

  private async _goto(goal: Goal, timeout = PATH_TIMEOUT_MS) {
    const bot = this.bot!
    const task: Task = { kind: 'path', goal }
    this.task = task
    let stopWatching = () => {}
    try {
      const walking = this.pathfinder.goto(goal, {
        movements: this._movements(),
        thinkTimeout: THINK_TIMEOUT_MS,
        tickTimeout: TICK_TIMEOUT_MS,
      })
      // The pathfinder can end a route a block off from where it planned and then just stand there, never
      // re-planning. Once the bot has stopped getting anywhere, it either got there after all or the walk is over.
      const stalled = new Promise<void>((resolve, reject) => {
        stopWatching = watchStall(
          bot,
          (error) => (goal.isEnd(bot.entity.position.floored()) ? resolve() : reject(error)),
          IDLE_GIVE_UP_MS
        )
      })
      await withTimeout(Promise.race([walking, stalled]), timeout, 'Took too long to get there.')
    } catch (error) {
      if (this.task !== task || this._inDanger()) {
        throw new Interrupted()
      }
      // Leave the goal alone if a fight already took the pathfinder over.
      if (bot.pathfinder?.goal === goal) {
        this.pathfinder.clearTemporaryGoal()
      }
      throw error
    } finally {
      stopWatching()
      if (this.task === task) {
        this.task = null
      }
    }
    if (bot.pathfinder?.goal === goal) {
      this.pathfinder.clearTemporaryGoal()
    }
  }

  // Mining's own movement rules: no parkour, and placing and digging cost more, so the bot walks around
  // instead of bridging or tunneling, and only does either when there's no other way to reach something.
  private _movements() {
    const bot = this.bot!
    if (!this.movements) {
      const movements = new Movements(bot)
      avoidBigCaves(movements, bot)
      movements.allowParkour = false
      movements.placeCost = 3
      // Walk around a wall rather than dig through it, unless digging is the only way (ores in stone).
      movements.digCost = 2
      for (const name of SCAFFOLD_ITEMS) {
        const id = bot.registry.itemsByName[name]?.id
        if (id !== undefined && !movements.scafoldingBlocks.includes(id)) {
          movements.scafoldingBlocks.push(id)
        }
      }
      for (const name of CHEST_NAMES) {
        const id = bot.registry.blocksByName[name]?.id
        if (id !== undefined) {
          movements.blocksCantBreak.add(id)
        }
      }
      this.movements = movements
    }
    applyBlockEditing(this.movements, this.pathfinder.isBlockBreakingAllowed())
    return this.movements
  }

  private _targetIds() {
    const bot = this.bot!
    return new Set(
      [...this.ores.flatMap((ore) => ORE_BLOCKS[ore]), ...this.blocks]
        .map((name) => bot.registry.blocksByName[name]?.id)
        .filter((id): id is number => id !== undefined)
    )
  }

  private _isAvailable(position: Vec3, now = Date.now()) {
    // Never dig up a chest the loot goes into, even if chests were picked.
    if (this.chests.some((chest) => chest.equals(position))) {
      return false
    }
    const failedAt = this.failedBlocks.get(posKey(position))
    return !failedAt || now - failedAt >= FAILED_BLOCK_COOLDOWN_MS
  }

  // The nearest tree or vein: a small search first, widening only if nothing turns up.
  private _findCluster(): Cluster | null {
    const bot = this.bot!
    const ids = this._targetIds()
    const feet = bot.entity.position.floored()
    for (const maxDistance of SEARCH_RADII) {
      const seeds = bot
        .findBlocks({ matching: [...ids], maxDistance, count: SEARCH_COUNT })
        .filter((position) => this._isAvailable(position))
        .sort((a, b) => seedScore(feet, a) - seedScore(feet, b))
      if (seeds.length === 0) {
        continue
      }
      const origin = seeds[0]
      const blocks = collectCluster((position) => bot.blockAt(position), origin, ids)
      return { origin, blocks: blocks.length > 0 ? blocks : [origin], groundY: null }
    }
    return null
  }

  // Drops blocks that are gone (mined, or changed) or that failed, then picks the next one.
  private _nextInCluster(cluster: Cluster) {
    const bot = this.bot!
    const ids = this._targetIds()
    const now = Date.now()
    cluster.blocks = cluster.blocks.filter((position) => {
      const block = bot.blockAt(position)
      return block && ids.has(block.type) && this._isAvailable(position, now)
    })
    return pickNext(this._sight(), cluster.blocks, bot.entity.position)
  }

  // The closest wanted block the bot could mine from where it stands.
  private _visibleTarget() {
    const bot = this.bot!
    const sight = this._sight()
    const now = Date.now()
    const feet = bot.entity.position
    return (
      bot
        .findBlocks({ matching: [...this._targetIds()], maxDistance: NEARBY_RADIUS, count: 8 })
        .filter((position) => this._isAvailable(position, now) && inReach(sight, feet, position))
        .sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))[0] ?? null
    )
  }

  // Every block with a hitbox the line passes through, nearest first, up to the target (the block `to` is in).
  private _sight(): SightLine {
    const world = this.bot!.world as unknown as {
      raycast(
        from: Vec3,
        direction: Vec3,
        range: number,
        matcher: (block: Block, iter: { intersect(shapes: number[][], offset: Vec3): unknown }) => boolean
      ): Block | null
    }
    return (from, to) => {
      const toTarget = to.minus(from)
      const distance = toTarget.norm()
      if (distance === 0) {
        return []
      }
      const direction = toTarget.normalize()
      const target = to.floored()
      const seen = new Set<string>()
      const hits: Vec3[] = []
      while (hits.length <= MAX_OBSTRUCTIONS + 1) {
        const block = world.raycast(
          from,
          direction,
          distance + 0.5,
          (candidate, iter) =>
            !seen.has(posKey(candidate.position)) &&
            Boolean(iter.intersect(candidate.shapes, candidate.position))
        )
        if (!block) {
          break
        }
        hits.push(block.position)
        seen.add(posKey(block.position))
        if (block.position.equals(target)) {
          break
        }
      }
      return hits
    }
  }

  // Fights and fleeing.
  private _startWatching() {
    this._stopWatching()
    this.watcher = setInterval(() => this._watch(), WATCH_INTERVAL_MS)
  }

  private _stopWatching() {
    if (this.watcher) {
      clearInterval(this.watcher)
      this.watcher = null
    }
    this.threat = null
  }

  private _watch() {
    const bot = this.bot
    if (!this.running || !bot?.entity) {
      return
    }
    if (this.isBusy() || bot.isSleeping) {
      this._interrupt()
      return
    }
    this.threat = this._findThreat()
    // Walking to a block but passing another wanted one in plain sight: stop and mine that first.
    if (!this.threat && this.task?.kind === 'path' && this.task.goal instanceof GoalReach) {
      const nearby = this._visibleTarget()
      if (nearby && !nearby.equals(this.task.goal.target)) {
        this._interrupt()
      }
      return
    }
    if (this.threat) {
      // Put the pickaxe down first, so the fight gets the pathfinder.
      this._interrupt()
      if (!this.engagedAt.has(this.threat.id)) {
        this.engagedAt.set(this.threat.id, Date.now())
        this.defend?.(this.threat)
      }
    }
  }

  private _inDanger() {
    return this.isBusy() || Boolean(this.bot?.isSleeping) || Boolean(this.threat?.isValid)
  }

  // Stops whatever the miner is doing right now; the step it was in ends with Interrupted.
  private _interrupt() {
    const bot = this.bot
    const task = this.task
    this.task = null
    if (!bot || !task) {
      return
    }
    if (task.kind === 'dig') {
      try {
        bot.stopDigging()
      } catch {
        // not digging
      }
    } else if (bot.pathfinder?.goal === task.goal) {
      this.pathfinder.clearTemporaryGoal()
    }
  }

  // A hostile mob close by that can see the bot (or is right on top of it).
  private _findThreat() {
    const bot = this.bot!
    const now = Date.now()
    const eye = bot.entity.position.offset(0, bot.entity.height ?? 1.62, 0)
    let best: Entity | null = null
    let bestDistance = Infinity
    for (const entity of Object.values(bot.entities)) {
      if (!entity?.isValid || entity === bot.entity || !isHostile(entity)) {
        continue
      }
      const engaged = this.engagedAt.get(entity.id)
      if (engaged !== undefined && now - engaged > THREAT_GIVE_UP_MS) {
        continue
      }
      const offset = entity.position.minus(bot.entity.position)
      if (Math.hypot(offset.x, offset.z) > THREAT_RADIUS || Math.abs(offset.y) > THREAT_VERTICAL) {
        continue
      }
      const distance = entity.position.distanceTo(bot.entity.position)
      if (distance >= bestDistance) {
        continue
      }
      if (distance > THREAT_POINT_BLANK && !this._canSee(eye, entity)) {
        continue
      }
      best = entity
      bestDistance = distance
    }
    return best
  }

  private _canSee(eye: Vec3, entity: Entity) {
    const world = this.bot!.world as unknown as {
      raycast(from: Vec3, direction: Vec3, range: number): Block | null
    }
    const target = entity.position.offset(0, (entity.height ?? 1) * 0.8, 0)
    const toTarget = target.minus(eye)
    const distance = toTarget.norm()
    if (distance === 0) {
      return true
    }
    return !world.raycast(eye, toTarget.normalize(), distance)
  }

  private _mobName(entity: Entity) {
    return (entity.displayName ?? entity.name ?? 'a mob').toString().toLowerCase()
  }

  describeTargets() {
    const bot = this.bot
    const names = [
      ...this.ores.map((ore) => `${ore} ore`),
      ...this.blocks.map((name) => bot?.registry.blocksByName[name]?.displayName ?? name),
    ]
    return names.length > 3 ? `${names.slice(0, 3).join('/')} or ${names.length - 3} more` : names.join('/')
  }

  private _markFailed(position: Vec3) {
    this.failedBlocks.set(posKey(position), Date.now())
  }

  private _freeSlots() {
    return this.bot!.inventory.emptySlotCount()
  }

  private _setStatus(status: string) {
    if (this.status === status) {
      return
    }
    this.status = status
    this.onUpdate?.()
  }
}
