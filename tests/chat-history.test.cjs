const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { ChatBridge } = require('../src/bot/chatBridge')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/chat.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText, { exports: exportsObject })
const { mergeChatHistory } = exportsObject
const entry = index => ({ id: String(index), text: `Message ${index}`, timestamp: index, author: 'Server', type: 'system', position: null })
test('saved history keeps older messages beyond the previous 2000 message limit', () => {
  const old = Array.from({ length: 2500 }, (_, index) => entry(index))
  const history = mergeChatHistory(old, [entry(2500)])
  assert.equal(history.length, 2501)
  assert.equal(history[0].id, '0')
  assert.equal(history[2500].id, '2500')
})
test('merged history deduplicates ids and sorts old and new batches by time', () => {
  const history = mergeChatHistory([entry(3), entry(1)], [entry(2), entry(3)])
  assert.equal(history.map(message => message.id).join(','), '1,2,3')
})
test('backend history retains all session messages beyond its previous 200 message limit', () => {
  const bridge = new ChatBridge(null)
  for (let index = 0; index < 500; index++) bridge._pushEntry(entry(index))
  const history = bridge.getHistory()
  assert.equal(history.length, 500)
  assert.equal(history[0].id, '0')
  history.pop()
  assert.equal(bridge.getHistory().length, 500)
})
