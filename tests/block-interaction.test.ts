import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import { openInteractiveBlock } from '../src/main/bot/actions/blockInteraction'
import { asBot, fakeBot } from './fakes'
const makeBot = (name = 'chest') => {
  const bot = fakeBot()
  bot.entity = { position: new Vec3(1, 0, 0) }
  bot.blockAt = (position: Vec3) => ({ name, position })
  bot.activateBlock = async () => bot.emit('windowOpen', { id: 1 })
  return bot
}
test('nearby containers open without walking and remove temporary listeners', async () => {
  const bot = makeBot()
  await openInteractiveBlock(asBot(bot), { x: 0, y: 0, z: 0 })
  assert.equal(bot.listenerCount('windowOpen'), 0)
  assert.equal(bot.listenerCount('end'), 0)
})
test('distant crafting tables are approached before activation', async () => {
  const bot = makeBot('crafting_table')
  const calls: string[] = []
  bot.pathfinder = {
    goto: async (goal: { x: number }) => {
      calls.push('walk')
      assert.equal(goal.x, 10)
      bot.entity.position.set(9, 0, 0)
    },
  }
  bot.activateBlock = async () => {
    calls.push('open')
    bot.emit('windowOpen', {})
  }
  await openInteractiveBlock(asBot(bot), { x: 10, y: 0, z: 0 })
  assert.deepEqual(calls, ['walk', 'open'])
})
test('unsupported blocks and invalid coordinates never activate', async () => {
  const bot = makeBot('stone')
  bot.activateBlock = () => assert.fail('must not activate')
  await assert.rejects(openInteractiveBlock(asBot(bot), { x: 0, y: 0, z: 0 }), /supported inventory/)
  await assert.rejects(openInteractiveBlock(asBot(bot), { x: NaN, y: 0, z: 0 }), /Invalid/)
})
test('activation errors and disconnects remove temporary listeners', async () => {
  for (const disconnected of [false, true]) {
    const bot = makeBot('anvil')
    bot.activateBlock = async () => {
      if (disconnected) bot.emit('end')
      else throw new Error('Cannot activate')
    }
    await assert.rejects(openInteractiveBlock(asBot(bot), { x: 0, y: 0, z: 0 }))
    assert.equal(bot.listenerCount('windowOpen'), 0)
    assert.equal(bot.listenerCount('end'), 0)
  }
})
