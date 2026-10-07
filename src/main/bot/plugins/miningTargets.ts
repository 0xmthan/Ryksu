import type { Block } from 'prismarine-block'
import type { Entity } from 'prismarine-entity'
import { Vec3 } from 'vec3'
import { Goal } from '../vendor/pathfinder/lib/goals'

// Survival block reach, measured from the eyes to the block's center.
export const REACH = 4.5
export const EYE_HEIGHT = 1.62

// A tree or ore vein is mined as one job, so the bot finishes it (top logs included) before moving on.
// The horizontal limit keeps a huge connected block (stone, dirt) from turning into one endless job.
const CLUSTER_LIMIT = 64
const CLUSTER_HORIZONTAL = 6
const CLUSTER_VERTICAL = 32

// Hostile mobs the miner leaves alone: neutral until provoked, can't be fought on foot, or not worth it.
const IGNORED_HOSTILES = new Set([
  'enderman',
  'zombified_piglin',
  'piglin',
  'warden',
  'ender_dragon',
  'wither',
  'elder_guardian',
  'guardian',
  'giant',
  'shulker',
  'evoker_fangs',
  'skeleton_horse',
  'zombie_horse',
  'creaking',
  'ghast',
  'phantom',
])

// The solid blocks a straight line from `from` to `to` passes through, nearest first, stopping a little past
// `to` (or after a handful of blocks).
export type SightLine = (from: Vec3, to: Vec3) => Vec3[]

// A spot is still worth walking to if this many blocks (stone, leaves) stand between the bot and the target;
// it digs them out of the way first, like a player tunneling to an ore.
export const MAX_OBSTRUCTIONS = 2

const eyeAt = (feet: Vec3) => feet.offset(0.5, EYE_HEIGHT, 0.5)

const eyeDistance = (feet: Vec3, block: Vec3) => eyeAt(feet).distanceTo(block.offset(0.5, 0.5, 0.5))

// Feet at `feet` (a floored position) means standing on the block right below.
export const isStandingOn = (feet: Vec3, block: Vec3) =>
  feet.x === block.x && feet.z === block.z && feet.y - 1 === block.y

// The blocks in the way when looking from feet at `feet` at the target: aiming at its center, or at the middle
// of a face turned toward the bot, whichever has the fewest in the way. Empty means in plain sight; null means
// it can't be seen at all.
export const obstructions = (sight: SightLine, feet: Vec3, block: Vec3) => {
  const eye = eyeAt(feet)
  const center = block.offset(0.5, 0.5, 0.5)
  const points = [center]
  for (const axis of ['x', 'y', 'z'] as const) {
    const delta = eye[axis] - center[axis]
    if (Math.abs(delta) > 0.5) {
      const point = center.clone()
      point[axis] += Math.sign(delta) * 0.49
      points.push(point)
    }
  }
  let best: Vec3[] | null = null
  for (const point of points) {
    const hits = sight(eye, point)
    const index = hits.findIndex((hit) => hit.equals(block))
    if (index !== -1 && (best === null || index < best.length)) {
      best = hits.slice(0, index)
      if (index === 0) break
    }
  }
  return best
}

// Close enough and in plain sight, from feet at `feet` (floored, so it matches what the pathfinder plans).
export const inReach = (sight: SightLine, feet: Vec3, block: Vec3) => {
  const standing = feet.floored()
  return (
    eyeDistance(standing, block) <= REACH &&
    !isStandingOn(standing, block) &&
    obstructions(sight, standing, block)?.length === 0
  )
}

// Walk anywhere the block is within reach with at most a couple of blocks in the way, rather than right next
// to it. A log at the top of a tree can be mined from the trunk below or the ground nearby, so there's no need
// to climb onto the leaves for it. Standing on the block (or inside it), or on a block that's in the way,
// doesn't count.
export class GoalReach extends Goal {
  target: Vec3
  private sight: SightLine

  constructor(target: Vec3, sight: SightLine) {
    super()
    this.target = target
    this.sight = sight
  }

  // Leads the search toward the block rather than just to the edge of reach: around a wall or through a
  // buried vein, the closer spots are the ones that end up with a clear line to it.
  heuristic(node: Vec3) {
    return Math.max(0, eyeDistance(node, this.target) - 1.5)
  }

  isEnd(node: Vec3) {
    const { x, y, z } = this.target
    if (node.x === x && node.z === z && node.y >= y - 1 && node.y <= y + 1) {
      return false
    }
    if (eyeDistance(node, this.target) > REACH) {
      return false
    }
    const blocking = obstructions(this.sight, node, this.target)
    return (
      blocking !== null &&
      blocking.length <= MAX_OBSTRUCTIONS &&
      !blocking.some((position) => isStandingOn(node, position))
    )
  }
}

// Every matching block connected to `seed` (corners count), within a box around it.
export const collectCluster = (
  blockAt: (position: Vec3) => Block | null,
  seed: Vec3,
  matches: Set<number>,
  limit = CLUSTER_LIMIT
) => {
  const key = (p: Vec3) => `${p.x},${p.y},${p.z}`
  const seen = new Set([key(seed)])
  const found: Vec3[] = []
  const queue = [seed]
  while (queue.length > 0 && found.length < limit) {
    const position = queue.shift()!
    const block = blockAt(position)
    if (!block || !matches.has(block.type)) {
      continue
    }
    found.push(position)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const next = position.offset(dx, dy, dz)
          if (
            Math.abs(next.x - seed.x) > CLUSTER_HORIZONTAL ||
            Math.abs(next.z - seed.z) > CLUSTER_HORIZONTAL ||
            Math.abs(next.y - seed.y) > CLUSTER_VERTICAL ||
            seen.has(key(next))
          ) {
            continue
          }
          seen.add(key(next))
          queue.push(next)
        }
      }
    }
  }
  return found
}

// What to mine next: whatever is in reach from where the bot stands, otherwise the closest block. Going
// closest-first clears a trunk from the bottom, so the bot can then stand in it to reach the top.
export const pickNext = (sight: SightLine, blocks: Vec3[], feet: Vec3) => {
  let best: Vec3 | null = null
  let bestScore = Infinity
  const standing = feet.floored()
  for (const block of blocks) {
    const distance = eyeDistance(standing, block)
    const score = distance <= REACH && inReach(sight, standing, block) ? distance : distance + 100
    if (score < bestScore) {
      best = block
      bestScore = score
    }
  }
  return best
}

// Where to start looking: close by and near the bot's own level beats far above or below it.
export const seedScore = (feet: Vec3, block: Vec3) =>
  Math.hypot(block.x - feet.x, block.z - feet.z) + 2 * Math.abs(block.y - feet.y)

export const isHostile = (entity: Entity) =>
  (entity.kind === 'Hostile mobs' || entity.type === 'hostile') && !IGNORED_HOSTILES.has(entity.name ?? '')
