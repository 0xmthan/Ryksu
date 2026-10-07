import test from 'node:test'
import assert from 'node:assert/strict'
import { AutoToolController } from '../src/main/bot/plugins/autoTool'
import { asBot, fakeBot } from './fakes'

const HOTBAR_START = 36

// A bot holding a stone axe in the first hotbar slot, with `inventory` (item names) in the main inventory
// from slot 9. Answers with the slots it was told to equip.
const fightWith = async (inventory: string[], attacks = 5) => {
  const item = (name: string, slot: number) => ({ name, slot, count: 1, type: 1, nbt: null })
  const held = item('stone_axe', HOTBAR_START)
  const items = [...inventory.map((name, index) => item(name, 9 + index)), held]
  const equipped: number[] = []
  const bot = fakeBot({
    heldItem: held,
    inventory: { items: () => items, hotbarStart: HOTBAR_START },
    registry: { itemsByName: { stone_axe: { attackDamage: 9 }, diamond_axe: { attackDamage: 9 } } },
    equip: async ({ slot }: { slot: number }) => void equipped.push(slot),
  })
  const autoTool = new AutoToolController()
  autoTool.attach(asBot(bot))
  autoTool.setEnabled(true)
  for (let attack = 0; attack < attacks; attack++) await autoTool.equipBestWeapon()
  return equipped
}

test('fighting keeps the axe in hand when the rest are no better', async () => {
  assert.deepEqual(await fightWith(Array(12).fill('stone_axe')), [])
})

test('a better weapon in the inventory is still taken', async () => {
  assert.deepEqual(await fightWith(['stone_axe', 'diamond_axe'], 1), [10])
})
