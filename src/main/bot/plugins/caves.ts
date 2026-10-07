// Getting around underground: telling caves from the surface, steering clear of big open caves (falls, mobs,
// dead ends) unless there's no other way, and a goal for climbing out.
import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'
import { Vec3 } from 'vec3'
import { Goal } from '../vendor/pathfinder/lib/goals'
import type { Movements } from '../vendor/pathfinder/lib/movements'

// Extra cost of a step through a big cave, on top of the step's own cost (1). Enough that a tunnel or the
// surface wins when it's not much longer, small enough that the cave is still used when it's the only way.
export const BIG_CAVE_STEP_COST = 2
// How many of the probes around a spot have to be open air for it to count as a big cave.
const BIG_CAVE_OPEN = 12
const PROBES = [
  [4, 0],
  [-4, 0],
  [0, 4],
  [0, -4],
  [3, 3],
  [3, -3],
  [-3, 3],
  [-3, -3],
] as const
const PROBE_HEIGHTS = [1, 4]
const CACHE_MS = 10000

type BlockAt = (position: Vec3) => Block | null

const isOpen = (block: Block | null) =>
  Boolean(block) && block!.boundingBox === 'empty' && !block!.name.includes('lava')

// Leaves and glass let the sky through as far as getting out is concerned.
const blocksSky = (block: Block | null) =>
  Boolean(block) &&
  !block!.name.endsWith('_leaves') &&
  !block!.name.includes('glass') &&
  (block!.boundingBox === 'block' || block!.name === 'water' || block!.name === 'lava')

// Nothing but air (or leaves) between the bot's head and the top of the world.
export const hasSkyAbove = (blockAt: BlockAt, feet: Vec3, worldTop: number) => {
  const start = feet.floored()
  for (let y = start.y + 2; y < worldTop; y++) {
    if (blocksSky(blockAt(new Vec3(start.x, y, start.z)))) return false
  }
  return true
}

// Underground (no sky light reaches it) and open in most directions around and above: a big cave, as opposed
// to a tunnel, a ravine wall or a mined-out corridor.
export const isBigCave = (blockAt: BlockAt, feet: Vec3) => {
  const here = blockAt(feet)
  if (!here || (here.skyLight ?? 0) > 0) return false
  let open = 0
  for (const height of PROBE_HEIGHTS) {
    for (const [dx, dz] of PROBES) {
      if (isOpen(blockAt(feet.offset(dx, height, dz)))) open++
    }
  }
  return open >= BIG_CAVE_OPEN
}

// Makes the pathfinder prefer other routes to ones through big caves. Spots are remembered for a few seconds,
// since a search asks about the same ones over and over.
export const avoidBigCaves = (movements: Movements, bot: Bot) => {
  const cache = new Map<string, number>()
  let clearedAt = Date.now()
  const blockAt: BlockAt = (position) => bot.blockAt(position, false)
  movements.exclusionAreasStep.push((block) => {
    const position = block.position
    if (!position) return 0
    if (Date.now() - clearedAt > CACHE_MS) {
      cache.clear()
      clearedAt = Date.now()
    }
    const key = `${position.x},${position.y},${position.z}`
    let cost = cache.get(key)
    if (cost === undefined) {
      cost = isBigCave(blockAt, position) ? BIG_CAVE_STEP_COST : 0
      cache.set(key, cost)
    }
    return cost
  })
}

// Anywhere at least `y` high. The search leans upward, so it digs straight up (placing a block under itself
// as it goes) unless a cave passage or a slope gets there for less.
export class GoalAbove extends Goal {
  y: number

  constructor(y: number) {
    super()
    this.y = y
  }

  heuristic(node: Vec3) {
    return 2 * Math.max(0, this.y - node.y)
  }

  isEnd(node: Vec3) {
    return node.y >= this.y
  }
}
