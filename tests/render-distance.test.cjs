const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const registry = require('prismarine-registry')('1.20.4')
const { readSlice, computeInput } = require('../src/bot/worldView')
const { computeBlocks } = require('../src/bot/worldCompute')

// A flat world: stone up to y = 63, air above; the bot stands on it.
const stone = registry.blocksByName.stone.defaultState
const chunk = { getBlockStateId: (local) => (local.y < 64 ? stone : 0) }
const fakeBot = (radius) => ({
  registry,
  entity: { position: new Vec3(0.5, 64, 0.5) },
  world: { getColumn: () => chunk, getSkyLight: () => 15 },
  _worldRadius: radius,
})

const spanOf = (data) => {
  let max = 0
  for (let i = 0; i < data.positions.length; i += 3) max = Math.max(max, Math.abs(data.positions[i]))
  return max
}

test('the view covers the render distance it was given', () => {
  for (const radius of [32, 80]) {
    const bot = fakeBot(radius)
    const data = computeBlocks(computeInput(bot, readSlice(bot)))
    assert.equal(data.radius, radius)
    assert.equal(data.light.width, radius * 2 + 1)
    assert.equal(spanOf(data), radius)
  }
})

test('changing the render distance reads the area again at the new size', () => {
  const bot = fakeBot(32)
  readSlice(bot)
  bot._worldRadius = 52
  bot._worldDirty = true
  const slice = readSlice(bot)
  assert.equal(slice.radius, 52)
  assert.equal(slice.width, 105)
})

test('without a setting the view keeps the default distance', () => {
  const bot = fakeBot(undefined)
  assert.equal(readSlice(bot).radius, 52)
})
