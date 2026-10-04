const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const { openInteractiveBlock } = require('../src/bot/blockInteraction')
const makeBot = (name = 'chest') => {
  const bot = new EventEmitter()
  bot.entity = { position: new Vec3(1, 0, 0) }
  bot.blockAt = position => ({ name, position })
  bot.activateBlock = async () => bot.emit('windowOpen', { id: 1 })
  return bot
}
test('nearby containers open without walking and remove temporary listeners', async () => {
  const bot = makeBot()
  await openInteractiveBlock(bot, { x: 0, y: 0, z: 0 })
  assert.equal(bot.listenerCount('windowOpen'), 0)
  assert.equal(bot.listenerCount('end'), 0)
})
test('distant crafting tables are approached before activation', async () => {
  const bot = makeBot('crafting_table')
  const calls = []
  bot.pathfinder = { goto: async goal => {
    calls.push('walk')
    assert.equal(goal.x, 10)
    bot.entity.position.set(9, 0, 0)
  } }
  bot.activateBlock = async () => { calls.push('open'); bot.emit('windowOpen', {}) }
  await openInteractiveBlock(bot, { x: 10, y: 0, z: 0 })
  assert.deepEqual(calls, ['walk', 'open'])
})
test('unsupported blocks and invalid coordinates never activate', async () => {
  const bot = makeBot('stone')
  bot.activateBlock = () => assert.fail('must not activate')
  await assert.rejects(openInteractiveBlock(bot, { x: 0, y: 0, z: 0 }), /supported inventory/)
  await assert.rejects(openInteractiveBlock(bot, { x: NaN, y: 0, z: 0 }), /Invalid/)
})
test('activation errors and disconnects remove temporary listeners', async () => {
  for (const disconnected of [false, true]) {
    const bot = makeBot('anvil')
    bot.activateBlock = async () => {
      if (disconnected) bot.emit('end')
      else throw new Error('Cannot activate')
    }
    await assert.rejects(openInteractiveBlock(bot, { x: 0, y: 0, z: 0 }))
    assert.equal(bot.listenerCount('windowOpen'), 0)
    assert.equal(bot.listenerCount('end'), 0)
  }
})
