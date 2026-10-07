import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'
import { Vec3 } from 'vec3'
import { CHEST_NAMES } from '../bot/plugins/mining'
import { watchStall, type PathfinderController } from '../bot/plugins/pathfinder'
import { Movements, goals } from '../bot/vendor/pathfinder'
import type { Goal } from '../bot/vendor/pathfinder/lib/goals'
import type { Vec3Like } from '../../shared/ipc'

// Scripts often run in bases and farms, so they walk without breaking or placing blocks, and without parkour
// jumps (landing on farmland tramples it).
const REACH = 4.5
const EYE_HEIGHT = 1.62
const WALK_TIMEOUT_MS = 60_000
const STALL_MS = 4000
// Drops collectDrops goes for at most in one call.
const MAX_PICKUPS = 256

// The order digAll and useItemOnAll go through blocks in: always the nearest one next, or row by row like a snake (for
// fields).
export type VisitOrder = 'nearest' | 'rows'

// Whether the script that asked is still on; long jobs stop when it isn't.
type Alive = () => boolean

export type FoundBlock = {
  x: number
  y: number
  z: number
  name: string
  properties: Record<string, unknown>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const toVec3 = ({ x, y, z }: Vec3Like) => new Vec3(Math.floor(x), Math.floor(y), Math.floor(z))

// Row by row along the longer side, every other row backwards, so a field is crossed once.
export const rowOrder = (positions: Vec3[]) => {
  const span = (axis: 'x' | 'z') =>
    Math.max(...positions.map((position) => position[axis])) -
    Math.min(...positions.map((position) => position[axis]))
  const along = span('x') >= span('z') ? 'x' : 'z'
  const across = along === 'x' ? 'z' : 'x'
  const rows = [...new Set(positions.map((position) => position[across]))].sort((a, b) => a - b)
  return rows.flatMap((row, index) =>
    positions
      .filter((position) => position[across] === row)
      .sort((a, b) => (index % 2 === 0 ? a[along] - b[along] : b[along] - a[along]))
  )
}

const describeBlock = (block: Block): FoundBlock => ({
  x: block.position.x,
  y: block.position.y,
  z: block.position.z,
  name: block.name,
  properties: block.getProperties(),
})

// The world calls of the script API, on the connected bot.
export class ScriptWorld {
  private getBot: () => Bot | null
  private pathfinder: PathfinderController
  private movements: { bot: Bot; movements: Movements } | null = null

  constructor({ getBot, pathfinder }: { getBot: () => Bot | null; pathfinder: PathfinderController }) {
    this.getBot = getBot
    this.pathfinder = pathfinder
  }

  private bot() {
    const bot = this.getBot()
    if (!bot?.entity) throw new Error('The bot is not in the world.')
    return bot
  }

  async walk(goal: Goal) {
    const bot = this.bot()
    let stopWatching = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.pathfinder.goto(goal, { movements: this._movements(bot) }),
        // The pathfinder can stop a block short and stand there; that's arrival if the goal is met.
        new Promise<void>((resolve, reject) => {
          stopWatching = watchStall(
            bot,
            (error) => (goal.isEnd(bot.entity.position.floored()) ? resolve() : reject(error)),
            STALL_MS
          )
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Took too long to get there.')), WALK_TIMEOUT_MS)
        }),
      ])
    } finally {
      stopWatching()
      clearTimeout(timer)
      if (bot.pathfinder?.goal === goal) this.pathfinder.clearTemporaryGoal()
    }
  }

  blockAt(position: Vec3Like) {
    const block = this.bot().blockAt(toVec3(position))
    return block ? describeBlock(block) : null
  }

  // Blocks by name near the bot, nearest first; `properties` must all match (like { age: 7 } for ripe wheat).
  findBlocks(
    name: string,
    {
      maxDistance = 32,
      count = 4096,
      properties = {},
    }: { maxDistance?: number; count?: number; properties?: object }
  ) {
    const bot = this.bot()
    const id = bot.registry.blocksByName[name]?.id
    if (id === undefined) throw new Error(`There's no block called "${name}".`)
    const wanted = Object.entries(properties)
    const origin = bot.entity.position
    return bot
      .findBlocks({
        matching: (block) =>
          block.type === id &&
          wanted.every(([key, value]) => String(block.getProperties()[key]) === String(value)),
        maxDistance,
        count,
      })
      .sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin))
      .map((position) => describeBlock(bot.blockAt(position)!))
  }

  // Walks within reach of a block and breaks it.
  async dig(position: Vec3Like) {
    const block = await this._reach(position)
    if (block.name === 'air') return
    await this.bot().dig(block, true)
  }

  // Holds the item and uses it on the block's top (seeds on farmland, bone meal on a crop, …).
  async useItemOn(position: Vec3Like, itemName: string) {
    const bot = this.bot()
    const item = bot.inventory.items().find((candidate) => candidate.name === itemName)
    if (!item) throw new Error(`No ${itemName} in the inventory.`)
    const block = await this._reach(position)
    await bot.equip(item, 'hand')
    await bot.lookAt(block.position.offset(0.5, 1, 0.5), true)
    await bot.activateBlock(block, new Vec3(0, 1, 0))
  }

  // Breaks all the blocks: everything in reach first, without a step, then on to the next one in `order`.
  // Answers with how many it broke and how many it couldn't get to.
  async digAll(positions: Vec3Like[], { order = 'nearest' }: { order?: VisitOrder }, alive: Alive) {
    const bot = this.bot()
    const { done, skipped } = await this._visitAll(positions, order, alive, async (block) => {
      if (block.name === 'air') return 'skipped'
      await bot.dig(block, true)
      return 'done'
    })
    return { dug: done, skipped }
  }

  // Uses the item on the top of all the blocks (seeds on farmland), in the same way as digAll, until it runs
  // out of the item. Answers with how many it used and how many it couldn't get to.
  async useItemOnAll(
    positions: Vec3Like[],
    itemName: string,
    { order = 'nearest' }: { order?: VisitOrder },
    alive: Alive
  ) {
    const bot = this.bot()
    const { done, skipped } = await this._visitAll(positions, order, alive, async (block) => {
      const item = bot.inventory.items().find((candidate) => candidate.name === itemName)
      if (!item) return 'stop'
      if (bot.heldItem?.name !== itemName) await bot.equip(item, 'hand')
      await bot.lookAt(block.position.offset(0.5, 1, 0.5), true)
      await bot.activateBlock(block, new Vec3(0, 1, 0))
      return 'done'
    })
    return { used: done, skipped }
  }

  // Does `act` on every block in reach, nearest first and without a step, then walks on to the next one in
  // `order`, until all are done, `act` says stop, or the script turns off.
  private async _visitAll(
    positions: Vec3Like[],
    order: VisitOrder,
    alive: Alive,
    act: (block: Block) => Promise<'done' | 'skipped' | 'stop'>
  ) {
    const bot = this.bot()
    let remaining = positions.map(toVec3)
    if (order === 'rows') remaining = rowOrder(remaining)
    let done = 0
    let skipped = 0
    const distance = (position: Vec3) =>
      bot.entity.position.offset(0, EYE_HEIGHT, 0).distanceTo(position.offset(0.5, 0.5, 0.5))
    while (remaining.length > 0 && alive()) {
      const inReach = remaining
        .filter((position) => distance(position) <= REACH)
        .sort((a, b) => distance(a) - distance(b))
      for (const position of inReach) {
        if (!alive()) break
        remaining = remaining.filter((other) => other !== position)
        const block = bot.blockAt(position)
        if (!block || distance(position) > REACH) continue
        const result = await act(block)
        if (result === 'stop') return { done, skipped }
        if (result === 'done') done++
      }
      if (inReach.length > 0 || remaining.length === 0) continue
      const next =
        order === 'rows' ? remaining[0] : remaining.reduce((a, b) => (distance(b) < distance(a) ? b : a))
      try {
        await this.walk(new goals.GoalNear(next.x, next.y, next.z, 2))
      } catch {
        // Unreachable: counted below.
      }
      if (distance(next) > REACH) {
        remaining = remaining.filter((other) => other !== next)
        skipped++
      }
    }
    return { done, skipped }
  }

  // Walks over the dropped items within `radius` blocks, nearest first.
  async collectDrops({ radius = 8 }: { radius?: number }, alive: Alive) {
    const bot = this.bot()
    const origin = bot.entity.position.clone()
    const tried = new Set<number>()
    // Drops take a moment to appear after a block breaks.
    await sleep(300)
    for (let pickups = 0; pickups < MAX_PICKUPS && alive(); pickups++) {
      const position = bot.entity.position
      const drop = Object.values(bot.entities)
        .filter(
          (entity) =>
            entity?.name === 'item' &&
            entity.isValid &&
            !tried.has(entity.id) &&
            entity.position.distanceTo(origin) <= radius
        )
        .sort((a, b) => a.position.distanceTo(position) - b.position.distanceTo(position))[0]
      if (!drop) return pickups
      tried.add(drop.id)
      const { x, y, z } = drop.position.floored()
      try {
        await this.walk(new goals.GoalNear(x, y, z, 1))
        await sleep(150)
      } catch {
        // Out of reach; on to the next one.
      }
    }
    return MAX_PICKUPS
  }

  inventory() {
    const totals = new Map<string, number>()
    for (const item of this.bot().inventory.items()) {
      totals.set(item.name, (totals.get(item.name) ?? 0) + item.count)
    }
    return [...totals].map(([name, count]) => ({ name, count }))
  }

  freeSlots() {
    return this.bot().inventory.emptySlotCount()
  }

  // Puts items in the chest or barrel at `position`: `only` these names (everything when left out), keeping
  // `keep[name]` of each. Answers with how many went in; stops early when the chest fills up.
  async deposit(position: Vec3Like, { only, keep = {} }: { only?: string[]; keep?: Record<string, number> }) {
    const bot = this.bot()
    const chest = await this._chest(position)
    const container = await bot.openContainer(chest)
    let stored = 0
    try {
      for (const { name, count } of this.inventory()) {
        if (only && !only.includes(name)) continue
        const amount = count - Math.max(0, Number(keep[name]) || 0)
        if (amount <= 0) continue
        try {
          await container.deposit(bot.registry.itemsByName[name].id, null, amount)
          stored += amount
        } catch (error) {
          if (/full/i.test((error as Error | undefined)?.message ?? '')) break
          throw error
        }
      }
    } finally {
      container.close()
    }
    return stored
  }

  // Takes items out of the chest at `position`: up to `items[name]` of each. Answers with how many it took;
  // stops early when the inventory fills up.
  async withdraw(position: Vec3Like, items: Record<string, number>) {
    const bot = this.bot()
    const chest = await this._chest(position)
    const container = await bot.openContainer(chest)
    let taken = 0
    try {
      for (const [name, wanted] of Object.entries(items)) {
        const id = bot.registry.itemsByName[name]?.id
        if (id === undefined) throw new Error(`There's no item called "${name}".`)
        const available = container
          .containerItems()
          .filter((item) => item.type === id)
          .reduce((sum, item) => sum + item.count, 0)
        const amount = Math.min(available, Math.max(0, Math.floor(Number(wanted) || 0)))
        if (amount <= 0) continue
        try {
          await container.withdraw(id, null, amount)
          taken += amount
        } catch (error) {
          if (/full/i.test((error as Error | undefined)?.message ?? '')) break
          throw error
        }
      }
    } finally {
      container.close()
    }
    return taken
  }

  // Walks to the chest or barrel at `position`.
  private async _chest(position: Vec3Like) {
    const bot = this.bot()
    const target = toVec3(position)
    const missing = () => new Error(`There's no chest at ${target.x} ${target.y} ${target.z}.`)
    if (!CHEST_NAMES.includes(bot.blockAt(target)?.name ?? '')) throw missing()
    await this.walk(new goals.GoalGetToBlock(target.x, target.y, target.z))
    const chest = bot.blockAt(target)
    if (!chest || !CHEST_NAMES.includes(chest.name)) throw missing()
    return chest
  }

  // Walks until the block is within reach.
  private async _reach(position: Vec3Like) {
    const bot = this.bot()
    const target = toVec3(position)
    const inReach = () =>
      bot.entity.position.offset(0, EYE_HEIGHT, 0).distanceTo(target.offset(0.5, 0.5, 0.5)) <= REACH
    if (!inReach()) await this.walk(new goals.GoalNear(target.x, target.y, target.z, 2))
    const block = bot.blockAt(target)
    if (!block) throw new Error(`The block at ${target.x} ${target.y} ${target.z} isn't loaded.`)
    if (!inReach()) throw new Error(`Couldn't get close to ${target.x} ${target.y} ${target.z}.`)
    return block
  }

  private _movements(bot: Bot) {
    if (this.movements?.bot !== bot) {
      const movements = new Movements(bot)
      movements.canDig = false
      movements.allow1by1towers = false
      movements.scafoldingBlocks = []
      movements.allowParkour = false
      this.movements = { bot, movements }
    }
    return this.movements.movements
  }
}
