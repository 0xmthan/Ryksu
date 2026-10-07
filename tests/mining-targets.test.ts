import test from 'node:test'
import assert from 'node:assert/strict'
import type { Block } from 'prismarine-block'
import { Vec3 } from 'vec3'
import {
  GoalReach,
  type SightLine,
  collectCluster,
  inReach,
  obstructions,
  pickNext,
} from '../src/main/bot/plugins/miningTargets'
import { fake } from './fakes'

const LOG = 1
const LEAVES = 2

// A world of logs (and anything else) at the given positions; everything else is air.
const world = (blocks: Record<string, number>) => (position: Vec3) => {
  const type = blocks[`${position.x},${position.y},${position.z}`]
  return type === undefined ? null : fake<Block>({ type, position })
}

// An oak: a 7-high trunk with a leaf canopy around the top.
const tree = () => {
  const blocks: Record<string, number> = {}
  for (let y = 0; y < 7; y++) blocks[`0,${y},0`] = LOG
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx || dz) blocks[`${dx},5,${dz}`] = LEAVES
    }
  }
  return blocks
}

test('a tree is collected as one cluster, leaves left out', () => {
  const cluster = collectCluster(world(tree()), new Vec3(0, 0, 0), new Set([LOG]))
  assert.equal(cluster.length, 7)
  assert.deepEqual(
    cluster.map((p) => p.y).sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6]
  )
})

test('separate trees are separate clusters', () => {
  const blocks = { ...tree(), '9,0,0': LOG, '9,1,0': LOG }
  assert.equal(collectCluster(world(blocks), new Vec3(0, 0, 0), new Set([LOG])).length, 7)
  assert.equal(collectCluster(world(blocks), new Vec3(9, 0, 0), new Set([LOG])).length, 2)
})

test('a huge connected area is capped', () => {
  const blocks: Record<string, number> = {}
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) blocks[`${x},0,${z}`] = LOG
  assert.equal(collectCluster(world(blocks), new Vec3(0, 0, 0), new Set([LOG])).length, 64)
})

// Steps along the line (a little past its end) and lists the cells of `solid` it passes through, in order,
// like the world's raycast does.
const sightOver =
  (solid: Vec3[]): SightLine =>
  (from, to) => {
    const direction = to.minus(from).normalize()
    const range = to.distanceTo(from) + 0.5
    const hits: Vec3[] = []
    for (let t = 0; t <= range; t += 0.02) {
      const cell = from.plus(direction.scaled(t)).floored()
      const hit = solid.find((p) => p.equals(cell))
      if (hit && !hits.includes(hit)) hits.push(hit)
    }
    return hits
  }

const trunk = () => [0, 1, 2, 3, 4, 5, 6].map((y) => new Vec3(0, y, 0))

test('the top of a tree is out of reach from the ground but in reach from the cleared trunk', () => {
  const ground = new Vec3(1, 0, 0)
  const logs = trunk()
  assert.equal(inReach(sightOver(logs), ground, new Vec3(0, 6, 0)), false)
  assert.equal(inReach(sightOver(logs), ground, new Vec3(0, 4, 0)), true)
  // Standing in the trunk after its lower logs are gone, two blocks up.
  const top = logs.slice(5)
  assert.equal(inReach(sightOver(top), new Vec3(0, 2, 0), new Vec3(0, 6, 0)), false)
  assert.equal(inReach(sightOver(top), new Vec3(0, 2, 0), new Vec3(0, 5, 0)), true)
  assert.equal(inReach(sightOver(top.slice(1)), new Vec3(0, 2, 0), new Vec3(0, 6, 0)), true)
})

test('a block behind a wall is not in reach, but a spot behind a thin wall is worth walking to', () => {
  const ore = new Vec3(3, 1, 0)
  const feet = new Vec3(0, 0, 0)
  assert.equal(inReach(sightOver([ore]), feet, ore), true)
  const wall = [new Vec3(2, 0, 0), new Vec3(2, 1, 0), new Vec3(2, 2, 0)]
  assert.equal(inReach(sightOver([ore, ...wall]), feet, ore), false)
  // One block of stone in the way: it gets dug first, so the bot can stop here.
  assert.deepEqual(obstructions(sightOver([ore, ...wall]), feet, ore)?.length, 1)
  assert.equal(new GoalReach(ore, sightOver([ore, ...wall])).isEnd(feet), true)
  // Three thick is too much to dig through from here.
  const far = new Vec3(4, 1, 0)
  const layers = [1, 2, 3].flatMap((x) => [0, 1, 2].map((y) => new Vec3(x, y, 0)))
  assert.equal(obstructions(sightOver([far, ...layers]), feet, far)?.length, 3)
  assert.equal(new GoalReach(far, sightOver([far, ...layers])).isEnd(feet), false)
})

test('the block the bot stands on never counts as in the way', () => {
  // Straight down through the floor: digging it would drop the bot.
  const ore = new Vec3(0, -3, 0)
  const goal = new GoalReach(ore, sightOver([ore, new Vec3(0, -1, 0), new Vec3(0, -2, 0)]))
  assert.equal(goal.isEnd(new Vec3(0, 0, 0)), false)
})

test('the block under the feet is never counted as in reach', () => {
  const block = new Vec3(0, 0, 0)
  assert.equal(inReach(sightOver([block]), new Vec3(0, 1, 0), block), false)
})

test('logs in reach go first, then the closest one', () => {
  const logs = trunk()
  assert.equal(pickNext(sightOver(logs), logs, new Vec3(1, 0, 0))?.y, 1)
  // From the ground the rest are out of reach; the lowest is the closest.
  assert.equal(pickNext(sightOver(logs.slice(5)), logs.slice(5), new Vec3(1, 0, 0))?.y, 5)
})

test('reach goal ends within reach and in sight, not inside or on top of the block', () => {
  const top = new Vec3(0, 6, 0)
  const goal = new GoalReach(top, sightOver([top]))
  assert.equal(goal.isEnd(new Vec3(1, 0, 0)), false)
  assert.equal(goal.isEnd(new Vec3(0, 2, 0)), true)
  assert.equal(goal.isEnd(new Vec3(0, 7, 0)), false)
  assert.equal(goal.isEnd(new Vec3(0, 5, 0)), false)
  // The search is pulled toward the block.
  assert.ok(goal.heuristic(new Vec3(3, 0, 0)) > goal.heuristic(new Vec3(1, 0, 0)))
})
