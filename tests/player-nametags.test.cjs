const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const THREE = require('three')
const texts = [], fills = []
const context = {
  font: '', measureText: text => ({ width: text.length * 10 }), scale() {},
  fillText: text => texts.push(text), fillRect: (...args) => fills.push(args), strokeRect() {},
}
const canvas = { width: 0, height: 0, getContext: () => context }
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/watcher/playerNametag.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText, { exports: exportsObject, require, document: { createElement: () => canvas } })
const { createPlayerNametag, playerHealthText } = exportsObject
const entity = { name: 'Steve', health: 20, kind: 'player', crouching: false }
test('health labels preserve real health and mark unavailable health explicitly', () => {
  assert.equal(playerHealthText(20), '20')
  assert.equal(playerHealthText(8.56), '8.6')
  assert.equal(playerHealthText(-2), '0')
  assert.equal(playerHealthText(), '?')
  assert.equal(playerHealthText(NaN), '?')
})
test('nametag updates health and posture without redrawing unchanged data or intercepting clicks', () => {
  texts.length = 0
  const tag = createPlayerNametag(entity)
  assert.deepEqual(texts, ['Steve', '20'])
  tag.update({ ...entity })
  assert.equal(texts.length, 2)
  tag.update({ ...entity, health: 10, crouching: true })
  assert.deepEqual(texts.slice(-2), ['Steve', '10'])
  assert.equal(tag.sprite.position.y, 2.05)
  const hits = []
  tag.sprite.raycast(new THREE.Raycaster(), hits)
  assert.deepEqual(hits, [])
  tag.update({ ...entity, dead: true })
  assert.equal(tag.sprite.visible, false)
  tag.sprite.material.map.dispose()
  tag.sprite.material.dispose()
})
test('nametags stay at a small world size and draw a pixel heart', () => {
  fills.length = 0
  const tag = createPlayerNametag(entity)
  assert.ok(fills.some(rect => rect[2] === 2 && rect[3] === 2))
  const scene = new THREE.Scene()
  scene.add(tag.sprite)
  assert.equal(tag.sprite.scale.y, .3)
  const version = tag.sprite.material.map.version
  tag.setHovered(true)
  assert.ok(tag.sprite.material.map.version > version)
  const hoveredVersion = tag.sprite.material.map.version
  tag.setHovered(true)
  assert.equal(tag.sprite.material.map.version, hoveredVersion)
  tag.sprite.material.map.dispose()
  tag.sprite.material.dispose()
})

test('the bot has no nametag while other players do', () => {
  const trackedExports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/watcher/entityObjects.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText, { exports: trackedExports, require: name => {
    if (name === './playerNametag') return exportsObject
    if (name.includes('/appearance')) return { buildEntityModel: () => null, lookOf: entity => entity.name }
    if (name.includes('/animation') || name.includes('/itemMesh') || name === './sceneUtils') return {}
    return require(name)
  } })
  const player = trackedExports.createTracked(entity, new THREE.Vector3(), undefined)
  const bot = trackedExports.createTracked(entity, new THREE.Vector3(), undefined, { bot: true })
  assert.ok(player.nametag)
  assert.equal(bot.nametag, null)
  for (const entry of [player, bot]) entry.object.traverse(object => {
    if (object.isMesh) object.geometry.dispose()
    if (object.material) { object.material.map?.dispose(); object.material.dispose() }
  })
})
