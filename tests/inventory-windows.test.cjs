const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/inventoryWindows.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText, { exports: exportsObject })
const layout = (type, inventoryStart, resultSlot, title = '') => exportsObject.inventoryWindowLayout({ type, inventoryStart, resultSlot, title })
test('crafting table uses nine inputs and a separate result', () => {
  const window = layout('minecraft:crafting', 10, 0)
  assert.equal(window.columns, 3)
  assert.equal(window.result, 0)
  assert.equal(window.inputs.join(','), '1,2,3,4,5,6,7,8,9')
})
test('large chest keeps all 54 storage slots and renders nine columns', () => {
  const window = layout('minecraft:generic_9x6', 54, -1)
  assert.equal(window.columns, 9)
  assert.equal(window.inputs.length, 54)
  assert.equal(window.result, null)
})
test('anvil, furnace and smithing results stay separate from inputs', () => {
  for (const [type, start, result] of [['anvil', 3, 2], ['furnace', 3, 2], ['smithing', 4, 3]]) {
    const window = layout(`minecraft:${type}`, start, result)
    assert.equal(window.inputs.length, start - 1)
    assert.equal(window.inputs.includes(result), false)
    assert.equal(window.result, result)
  }
})
test('window titles preserve named chests and distinguish barrels', () => {
  assert.equal(layout('minecraft:generic_9x3', 27, -1, '{"text":"My supplies"}').title, 'My supplies')
  assert.equal(layout('minecraft:generic_9x3', 27, -1, '{"translate":"container.barrel"}').title, 'Barrel')
})
