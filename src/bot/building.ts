// Build mode in the watcher: break the clicked block, or place the held block against the clicked face.
// The bot walks to where it can reach and see the spot first.
import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'
import type { Item } from 'prismarine-item'
import { Vec3 } from 'vec3'
import type { BuildAction } from '../types'
import { goals } from './plugins/core/pathfinder'
import type { Goal, PlaceWorld } from './plugins/core/pathfinder/lib/goals'

type Vec3Like = { x: number; y: number; z: number }

// The bot's world has prismarine-world's raycast, which its typings don't list.
const placeWorld = (bot: Bot) => bot.world as unknown as PlaceWorld
type Cell = { cell: Vec3; face: Vec3Like | null }
// More cells for a line being built, from further drags of the same kind (see BotManager.buildAction).
export type BuildFeed = { incoming: { cells: Vec3Like[]; face?: Vec3Like }[] }

const REACH = 4.5
const WALK_TIMEOUT_MS = 20000

// Items whose block has another name. Anything else placeable has a block of its own name.
const PLACES_AS: Record<string, string> = {
  redstone: 'redstone_wire',
  string: 'tripwire',
  wheat_seeds: 'wheat',
  beetroot_seeds: 'beetroots',
  carrot: 'carrots',
  potato: 'potatoes',
  melon_seeds: 'melon_stem',
  pumpkin_seeds: 'pumpkin_stem',
  sweet_berries: 'sweet_berry_bush',
  glow_berries: 'cave_vines',
  cocoa_beans: 'cocoa',
}

export const isPlaceable = (bot: Bot, item: Item | null | undefined) => Boolean(item && bot.registry.blocksByName[PLACES_AS[item.name] ?? item.name])

const toVec = (position: Vec3Like | null | undefined) => {
  if (!position || !(['x', 'y', 'z'] as const).every((key) => Number.isInteger(position[key]))) {
    throw new Error('Invalid block position.')
  }
  return new Vec3(position.x, position.y, position.z)
}

const eyeDistance = (bot: Bot, position: Vec3) =>
  bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0).distanceTo(position.offset(0.5, 0.5, 0.5))

const walk = async (bot: Bot, goal: Goal) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      bot.pathfinder.goto(goal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          bot.pathfinder.setGoal(null)
          reject(new Error("Couldn't get close enough."))
        }, WALK_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    // No path, or interrupted: whether it's close enough is checked after.
    if (/close enough/.test(String((error as Error | undefined)?.message))) throw error
  } finally {
    clearTimeout(timer)
  }
}

const name = (block: Block) => block.displayName ?? block.name

// Whether the bot's body (0.6 wide, 1.8 tall) overlaps the block at `target`.
const inTheWay = (bot: Bot, target: Vec3) => {
  const { x, y, z } = bot.entity.position
  return (
    Math.abs(x - (target.x + 0.5)) < 0.8 &&
    Math.abs(z - (target.z + 0.5)) < 0.8 &&
    y < target.y + 1 &&
    y + 1.8 > target.y
  )
}

// Something to break there: not air or liquid (plants and flowers have no collision box, but count).
const LIQUIDS = new Set(['water', 'lava', 'bubble_column'])
export const isEmptySpace = (block: Block | null | undefined): block is null | undefined => !block || block.name.endsWith('air') || LIQUIDS.has(block.name)

export const breakBlock = async (bot: Bot, position: Vec3Like, { equipTool = false } = {}) => {
  const target = toVec(position)
  let block = bot.blockAt(target)
  if (!block || isEmptySpace(block)) throw new Error('Nothing to break there.')
  if (block.diggable === false || block.hardness === null || block.hardness < 0) {
    throw new Error(`${name(block)} can't be broken.`)
  }
  if (eyeDistance(bot, target) > REACH) {
    await walk(bot, new goals.GoalLookAtBlock(target, placeWorld(bot), { reach: REACH - 0.5 }))
  }
  block = bot.blockAt(target)
  if (!block || isEmptySpace(block)) throw new Error('The block is already gone.')
  if (eyeDistance(bot, target) > REACH) throw new Error(`${name(block)} is out of reach.`)

  // With auto tool on, use the best tool, then go back to the slot that was held.
  const slot = bot.quickBarSlot
  if (equipTool && bot.tool) {
    try {
      await bot.tool.equipForBlock(block, {})
    } catch {
      // Breaking by hand still works.
    }
  }
  try {
    await bot.dig(block, true)
  } finally {
    if (bot.quickBarSlot !== slot) bot.setQuickBarSlot(slot)
  }
  return `Broke ${name(block)}.`
}

export const placeBlock = async (bot: Bot, position: Vec3Like, face: Vec3Like) => {
  const against = toVec(position)
  const normal = toVec(face)
  if (Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z) !== 1) throw new Error('Invalid face.')
  const target = against.plus(normal)

  const item = bot.heldItem
  if (!item) throw new Error('Hold a block to place it.')
  if (!isPlaceable(bot, item)) throw new Error(`${item.displayName} can't be placed.`)
  const occupant = bot.blockAt(target)
  if (occupant && occupant.boundingBox !== 'empty') throw new Error(`${name(occupant)} is already there.`)

  // Too far, or in the way: walk to where it can see a face of the spot without standing in it.
  if (eyeDistance(bot, target) > REACH || inTheWay(bot, target)) {
    await walk(bot, new goals.GoalPlaceBlock(target, placeWorld(bot), { range: REACH - 0.5 }))
  }
  if (eyeDistance(bot, target) > REACH) throw new Error('That spot is out of reach.')
  if (inTheWay(bot, target)) throw new Error('The bot is standing there.')
  const reference = bot.blockAt(against)
  if (!reference || reference.boundingBox === 'empty') throw new Error('Nothing to place against there.')
  const held = bot.heldItem
  if (!held || held.name !== item.name) throw new Error('The held block changed.')

  await bot.lookAt(target.offset(0.5, 0.5, 0.5), true)
  try {
    await bot.placeBlock(reference, normal)
  } catch (error) {
    const message = (error as Error | undefined)?.message
    throw new Error(
      /refused|did not answer/i.test(String(message))
        ? `The server didn't let the bot place ${item.displayName}.`
        : message || 'Placing failed.'
    )
  }
  return `Placed ${item.displayName}.`
}

// The longest line one drag can make.
const MAX_CELLS = 32

// Neighbors to place against, floor first so torches and the like stand rather than hang.
const NEIGHBORS = [
  new Vec3(0, -1, 0),
  new Vec3(0, 0, -1),
  new Vec3(0, 0, 1),
  new Vec3(-1, 0, 0),
  new Vec3(1, 0, 0),
  new Vec3(0, 1, 0),
]

// A solid block next to `target` to place against: the clicked face's block if given, else any.
export const findSupport = (bot: Bot, target: Vec3, face: Vec3Like | null | undefined) => {
  for (const offset of face ? [toVec(face).scaled(-1), ...NEIGHBORS] : NEIGHBORS) {
    const block = bot.blockAt(target.plus(offset))
    if (block && block.boundingBox === 'block') return { position: block.position, face: offset.scaled(-1) }
  }
  return null
}

// Puts a stack of `itemName` in hand when the last one ran out. False when there's none left.
const holdItem = async (bot: Bot, itemName: string) => {
  if (bot.heldItem?.name === itemName) return true
  const item = bot.inventory.items().find((candidate) => candidate.name === itemName)
  if (!item) return false
  await bot.equip(item, 'hand')
  return true
}

// One block (walking to it included) gets this long before it counts as stuck.
const CELL_TIMEOUT_MS = 30000

// Races a step against the build being stopped and against the stuck timeout.
const step = <T>(promise: Promise<T>, stopped: Promise<unknown>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    stopped.then(() => {
      throw new Error('Stopped.')
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('That block took too long.')), CELL_TIMEOUT_MS)
    }),
  ]).finally(() => clearTimeout(timer))
}

// Cells skipped for these get another go after the rest of the line.
const RETRYABLE = /standing there|Nothing to place against|out of reach|close enough|took too long/i
// Passes stop as soon as one gets nowhere; this only bounds the worst case (one block per pass).
const MAX_PASSES = 256

// Why a cell got skipped instead of stopping the whole line.
const SKIPPABLE = /already there|standing there|Nothing to|out of reach|close enough|can't be broken|already gone|took too long/i

// Breaks or places every cell of a dragged line in order. One cell reports its own error; a longer line
// skips cells it can't do and stops only when the blocks run out or it's cancelled.
// A line can keep growing while it's built (more drags of the same kind), up to this many blocks.
const MAX_QUEUED = 256

const cellKey = (cell: Vec3Like) => `${cell.x},${cell.y},${cell.z}`

// Breaks or places every cell of a dragged line in order. One cell reports its own error; a longer line
// skips cells it can't do and stops only when the blocks run out or it's cancelled. `feed.incoming`
// takes more cells while it runs (cells already in the line are ignored); they join the end.
export type BuildOptions = {
  equipTool?: boolean
  onProgress?: (text: string) => void
  isCancelled?: () => boolean
  stopped?: Promise<unknown>
  feed?: BuildFeed | null
  // Hears the cells still to do whenever that changes, for the watcher to mark them.
  onRemaining?: (cells: Vec3Like[]) => void
}

export const buildCells = async (
  bot: Bot,
  action: BuildAction,
  {
    equipTool = false,
    onProgress = () => {},
    isCancelled = () => false,
    stopped = new Promise(() => {}),
    feed = null,
    onRemaining = () => {},
  }: BuildOptions = {}
): Promise<string> => {
  const placing = action?.type === 'place'
  if (!placing && action?.type !== 'break') throw new Error('Unknown build action.')
  const initial = Array.isArray(action?.cells) ? action.cells.slice(0, MAX_CELLS).map(toVec) : []
  if (!initial.length) throw new Error('Nothing to build.')

  const item = placing ? bot.heldItem : null
  if (placing && !item) throw new Error('Hold a block to place it.')
  if (placing && !isPlaceable(bot, item)) throw new Error(`${item!.displayName} can't be placed.`)

  // Every cell ever in the line, so a cell dragged twice is only built once, and the ones still to do.
  const known = new Set<string>()
  const remaining = new Map<string, Vec3>()
  const reportRemaining = () => onRemaining([...remaining.values()].map(({ x, y, z }) => ({ x, y, z })))
  const finish = (cell: Vec3) => {
    remaining.delete(cellKey(cell))
    reportRemaining()
  }
  let pending: Cell[] = []
  const add = (cells: Vec3[], face: Vec3Like | null | undefined) => {
    for (const [index, cell] of cells.entries()) {
      if (known.size >= MAX_QUEUED || known.has(cellKey(cell))) continue
      known.add(cellKey(cell))
      remaining.set(cellKey(cell), cell)
      pending.push({ cell, face: index === 0 ? (face ?? null) : null })
    }
    reportRemaining()
  }
  add(initial, action.type === 'place' ? action.face : null)
  const takeIncoming = () => {
    if (!feed?.incoming.length) return false
    for (const extra of feed.incoming.splice(0)) add(extra.cells.slice(0, MAX_CELLS).map(toVec), extra.face)
    return true
  }
  // A single click (nothing added since) reports its own error instead of skipping.
  const single = () => known.size === 1

  let done = 0
  let skipped = 0
  let attempted = 0
  let last = ''
  const stoppedMessage = () => `Stopped after ${done} of ${known.size}.`
  // Blocks that couldn't go in yet (no room to stand, nothing to rest against) are tried again after the
  // rest, since the blocks placed meanwhile often fix that. Passes repeat while they get anywhere.
  for (let pass = 0; pending.length && pass < MAX_PASSES; pass++) {
    // New cells (takeIncoming) land in `pending`, which is this pass's list until it ends.
    const current = pending
    const retry: Cell[] = []
    let progressed = false
    for (let index = 0; index < current.length; index++) {
      if (isCancelled()) return stoppedMessage()
      if (takeIncoming()) progressed = true
      const { cell, face } = current[index]
      if (!single()) {
        onProgress(
          pass === 0
            ? `${placing ? 'Placing' : 'Breaking'} ${++attempted}/${known.size}…`
            : `Retrying ${index + 1}/${current.length}…`
        )
      }
      try {
        if (placing) {
          if (!(await step(holdItem(bot, item!.name), stopped))) {
            return `Ran out of ${item!.displayName} after ${done}.`
          }
          const occupant = bot.blockAt(cell)
          if (occupant && occupant.boundingBox !== 'empty') throw new Error(`${name(occupant)} is already there.`)
          const support = findSupport(bot, cell, face)
          if (!support) throw new Error('Nothing to place against there.')
          last = await step(placeBlock(bot, support.position, support.face), stopped)
        } else {
          const block = bot.blockAt(cell)
          if (!single() && (!block || block.boundingBox === 'empty')) {
            skipped++
            finish(cell)
            continue
          }
          last = await step(breakBlock(bot, cell, { equipTool }), stopped)
        }
        done++
        progressed = true
        finish(cell)
      } catch (error) {
        if (isCancelled()) return stoppedMessage()
        const message = String((error as Error | undefined)?.message)
        if (single()) throw error
        if (!SKIPPABLE.test(message)) return `${placing ? 'Placed' : 'Broke'} ${done}, then: ${message || 'it failed.'}`
        if (RETRYABLE.test(message)) retry.push({ cell, face })
        else {
          skipped++
          finish(cell)
        }
      }
    }
    // Cells added during the last step go round with the retries.
    pending = retry
    const waiting = retry.length
    takeIncoming()
    if (pending.length > waiting) progressed = true
    // A pass that built nothing won't do better the next time round.
    if (!progressed) {
      skipped += pending.length
      pending = []
    }
  }
  skipped += pending.length
  if (single()) return last
  const what = placing ? `Placed ${done} ${item!.displayName}` : `Broke ${done} block${done === 1 ? '' : 's'}`
  return skipped ? `${what} · skipped ${skipped}.` : `${what}.`
}
