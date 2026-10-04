const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const THREE = require('three')
const compile = (file, requireModule) => {
  const exportsObject = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
  }).outputText, { exports: exportsObject, require: requireModule })
  return exportsObject
}
const geometry = compile('src/utils/entity/geometry.ts', require)
let armorLayers = []
const modelTools = {
  addLayer: (_model, bones) => armorLayers.push(...bones),
  textureSize: () => ({ width: 64, height: 32 }),
  mobMaterial: map => new THREE.MeshLambertMaterial({ map }) }
const shield = compile('src/utils/entity/shield.ts', name => {
  if (name === './geometry') return geometry
  if (name === './model') return modelTools
  if (name === './textures') return { textureFromUrl: () => new THREE.Texture() }
  if (name.includes('shieldModel.json')) return require('../src/generated/shieldModel.json')
  return require(name)
})
const equipment = compile('src/utils/entity/equipment.ts', name => {
  if (name === './shield') return shield
  if (name === './data') return { entityData: { armor: { humanoid: { iron: 0 } } } }
  if (name === './model') return modelTools
  if (name === './textures') return { loadTexture: () => new THREE.Texture() }
  if (name === './itemMesh') return { buildItemMesh: () => assert.fail('a held shield must not use its inventory sprite') }
  return require(name)
})
test('shield has a native plate and a handle behind it', () => {
  const mesh = shield.createShieldGeometry()
  mesh.computeBoundingBox()
  const size = mesh.boundingBox.getSize(new THREE.Vector3())
  assert.deepEqual(size.toArray(), [12, 22, 7])
  assert.equal(mesh.boundingBox.min.z, -2)
  assert.equal(mesh.boundingBox.max.z, 5)
  assert.equal(mesh.getAttribute('position').count, 48)
  mesh.dispose()
})
test('left and right grips mirror outward without scaling the shield down', () => {
  const left = shield.buildHeldShield(1)
  const right = shield.buildHeldShield(-1)
  assert.equal(left.rotation.y, -right.rotation.y)
  assert.equal(left.position.x, -right.position.x)
  assert.deepEqual(left.children[0].scale.toArray(), [1, 1, 1])
  assert.equal(left.children[0].position.y, -2)
  for (const holder of [left, right]) {
    holder.children[0].geometry.dispose()
    holder.children[0].material.dispose()
  }
})
test('offhand shield attaches to the left palm using the dedicated grip', () => {
  const arm = new THREE.Group()
  const model = {
    bones: new Map([['leftarm', arm]]),
    boneData: new Map([['leftarm', { cubes: [{ origin: [4, 12, -2], size: [4, 12, 4] }] }]]),
    pivots: new Map([['leftarm', new THREE.Vector3(5, 22, 0)]]),
    materials: [],
  }
  equipment.addEquipment(model, { offhand: { name: 'shield' } })
  assert.equal(arm.children.length, 1)
  assert.equal(arm.children[0].name, 'shield-grip')
  assert.deepEqual(arm.children[0].position.toArray(), [3, -9, 0])
  assert.equal(model.materials.length, 1)
  arm.children[0].children[0].geometry.dispose()
  model.materials[0].dispose()
})

test('chestplate sleeves use standard armor UV dimensions on slim skins', () => {
  armorLayers = []
  const boneData = new Map(['head', 'body', 'rightarm', 'leftarm', 'rightleg', 'leftleg'].map(name => [name, { name }]))
  boneData.set('body', { name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4] }] })
  boneData.set('leftarm', { name: 'leftArm', pivot: [5, 22, 0], cubes: [{ origin: [4, 12, -2], size: [3, 12, 4] }] })
  boneData.set('rightarm', { name: 'rightArm', pivot: [-5, 22, 0], cubes: [{ origin: [-7, 12, -2], size: [3, 12, 4] }] })
  equipment.addEquipment({ boneData, bones: new Map(), materials: [] }, { chest: { name: 'iron_chestplate' } })
  const sleeves = armorLayers.filter(bone => /arm/i.test(bone.name))
  assert.equal(sleeves.length, 2)
  for (const bone of sleeves) {
    assert.equal(bone.cubes[0].size[0], 4)
    assert.equal(bone.cubes[0].inflate, 1)
    assert.equal(bone.cubes[0].uv.join(','), '40,16')
  }
  assert.equal(sleeves.find(bone => bone.name === 'rightArm').cubes[0].origin[0], -8)
  assert.equal(sleeves.find(bone => bone.name === 'leftArm').cubes[0].origin[0], 4)
  assert.equal(boneData.get('leftarm').cubes[0].size[0], 3)
  assert.equal(boneData.get('rightarm').cubes[0].origin[0], -7)
})
