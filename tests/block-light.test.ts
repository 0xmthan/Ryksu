import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spreadLight } from '../src/main/bot/world/worldView'

// A 5×1×5 floor slice: palette 0 = torch, 1 = stone, 2 = leaves; -1 = air.
const emits = [14, 0, 0]
const filters = [0, 15, 1]
const at = (x: number, z: number) => z * 5 + x

test('block light fades one level per block and stops at solid blocks', () => {
  const grid = new Int16Array(25).fill(-1)
  grid[at(0, 0)] = 0
  grid[at(2, 0)] = 1
  const cells = spreadLight({ grid, emits, filters, width: 5, height: 1 })
  assert.equal(cells[at(0, 0)], 14)
  assert.equal(cells[at(1, 0)], 13)
  assert.equal(cells[at(2, 0)], 255)
  // Around the stone rather than through it: five steps away.
  assert.equal(cells[at(3, 0)], 9)
})

test('block light can only enter leaves and water dimmed', () => {
  const grid = new Int16Array(25).fill(-1)
  grid[at(0, 0)] = 0
  grid[at(1, 0)] = 2
  const cells = spreadLight({ grid, emits, filters, width: 5, height: 1 })
  assert.equal(cells[at(1, 0)], 13)
})
