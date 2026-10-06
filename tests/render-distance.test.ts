import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import type { Bot } from 'mineflayer'
import loadRegistry from 'prismarine-registry'
import { readSlice, computeInput, createWorldTracker, type WorldTracker } from '../src/bot/worldView'
import { computeBlocks } from '../src/bot/worldCompute'
import type { BlockView } from '../src/types'
import { fake } from './fakes'

const registry = loadRegistry('1.20.4')

// A flat world: stone up to y = 63, air above; the bot stands on it.
const stone = registry.blocksByName.stone.defaultState
const chunk = { getBlockStateId: (local: Vec3) => (local.y < 64 ? stone : 0) }
const fakeBot = () =>
  fake<Bot>({
    registry,
    entity: { position: new Vec3(0.5, 64, 0.5) },
    world: { getColumn: () => chunk, getSkyLight: () => 15 },
  })

// A first read always has a slice; later ones are null when nothing changed.
const read = (bot: Bot, tracker: WorldTracker) => {
  const slice = readSlice(bot, tracker)
  assert.ok(slice)
  return slice
}

const spanOf = (data: BlockView) => {
  let max = 0
  for (let i = 0; i < data.positions.length; i += 3) max = Math.max(max, Math.abs(data.positions[i]))
  return max
}

test('the view covers the render distance it was given', () => {
  for (const radius of [32, 80]) {
    const bot = fakeBot()
    const data = computeBlocks(computeInput(bot, read(bot, createWorldTracker(radius))))
    assert.equal(data.radius, radius)
    assert.equal(data.light.width, radius * 2 + 1)
    assert.equal(spanOf(data), radius)
  }
})

test('changing the render distance reads the area again at the new size', () => {
  const bot = fakeBot()
  const tracker = createWorldTracker(32)
  readSlice(bot, tracker)
  tracker.radius = 52
  tracker.dirty = true
  const slice = read(bot, tracker)
  assert.equal(slice.radius, 52)
  assert.equal(slice.width, 105)
})

test('without a setting the view keeps the default distance', () => {
  const bot = fakeBot()
  assert.equal(read(bot, createWorldTracker()).radius, 52)
})
