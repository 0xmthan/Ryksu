import test from 'node:test'
import assert from 'node:assert/strict'
import { runInventoryAction } from '../src/bot/inventoryActions'
import type { InventoryAction, InventoryClick } from '../src/types'
import { asBot, fake, fakeBot, type FakeBot } from './fakes'

const makeBot = () => {
  const calls: unknown[][] = []
  return fakeBot({
    calls,
    inventory: { slots: Array(46).fill(null) },
    clickWindow: async (...args: unknown[]) => calls.push(args),
    closeWindow: async (window: unknown) => calls.push(['close', window]),
  })
}
// Actions straight from the renderer, valid or not.
const run = (bot: FakeBot, action: object) => runInventoryAction(asBot(bot), fake<InventoryAction>(action))
test('inventory clicks preserve crafting, split, shift transfer and hotbar swap gestures', async () => {
  const bot = makeBot()
  const clicks: InventoryClick[] = [
    { slot: 9, button: 1, mode: 0 },
    { slot: 1, button: 1, mode: 0 },
    { slot: 0, button: 0, mode: 0 },
    { slot: 36, button: 0, mode: 1 },
    { slot: 10, button: 8, mode: 2 },
    { slot: -999, button: 1, mode: 0 },
  ]
  await run(bot, { type: 'click', clicks })
  assert.deepEqual(
    bot.calls,
    clicks.map(({ slot, button, mode }) => [slot, button, mode])
  )
})
test('an invalid click rejects the entire gesture before any item moves', async () => {
  for (const bad of [
    { slot: 46, button: 0, mode: 0 },
    { slot: -999, button: 0, mode: 1 },
    { slot: 9, button: 2, mode: 0 },
    { slot: 9, button: 0, mode: 5 },
  ]) {
    const bot = makeBot()
    await assert.rejects(run(bot, { type: 'click', clicks: [{ slot: 9, button: 0, mode: 0 }, bad] }))
    assert.deepEqual(bot.calls, [])
  }
})
test('closing uses the player window so the server returns crafting ingredients and cursor items', async () => {
  const bot = makeBot()
  await run(bot, { type: 'close' })
  assert.deepEqual(bot.calls, [['close', bot.inventory]])
})
test('container clicks accept its own slot range and close its own window', async () => {
  const bot = makeBot()
  bot.currentWindow = { id: 7, type: 'minecraft:generic_9x6', slots: Array(90).fill(null) }
  await run(bot, { type: 'click', windowId: 7, clicks: [{ slot: 89, button: 0, mode: 0 }] })
  await run(bot, { type: 'close', windowId: 7 })
  assert.deepEqual(bot.calls, [
    [89, 0, 0],
    ['close', bot.currentWindow],
  ])
  await assert.rejects(run(bot, { type: 'click', windowId: 7, clicks: [{ slot: 90, button: 0, mode: 0 }] }))
})
test('stale player or container gestures cannot touch a different window', async () => {
  const bot = makeBot()
  bot.currentWindow = { id: 7, slots: Array(63).fill(null) }
  await assert.rejects(
    run(bot, { type: 'click', windowId: 0, clicks: [{ slot: 9, button: 0, mode: 0 }] }),
    /no longer open/
  )
  await assert.rejects(run(bot, { type: 'close', windowId: 6 }), /no longer open/)
  assert.deepEqual(bot.calls, [])
})
test('anvil renaming sends the protocol name packet and rejects other windows', async () => {
  const bot = makeBot()
  bot.currentWindow = { id: 7, type: 'minecraft:anvil', slots: Array(39).fill(null) }
  bot.supportFeature = () => false
  bot._client = { write: (...args: unknown[]) => bot.calls.push(args) }
  await run(bot, { type: 'rename', windowId: 7, name: 'My sword' })
  assert.deepEqual(bot.calls, [['name_item', { name: 'My sword' }]])
  await assert.rejects(run(bot, { type: 'rename', windowId: 7, name: 'x'.repeat(36) }))
  bot.currentWindow.type = 'minecraft:chest'
  await assert.rejects(run(bot, { type: 'rename', windowId: 7, name: 'Sword' }))
})
