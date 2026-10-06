import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { Bone } from '../src/renderer/features/watcher/entity/data'
import type { MobModel } from '../src/renderer/features/watcher/entity/model'
import { fake } from './fakes'
import { loadModule } from './loadModule'

let armorLayers: Bone[] = []
const modelTools = {
  addLayer: (_model: unknown, bones: Bone[]) => armorLayers.push(...bones),
  textureSize: () => ({ width: 64, height: 32 }),
  mobMaterial: (map: THREE.Texture) => new THREE.MeshLambertMaterial({ map }),
}
const shield = loadModule<typeof import('../src/renderer/features/watcher/entity/shield')>(
  'src/renderer/features/watcher/entity/shield.ts',
  {
    './model': modelTools,
    './textures': { textureFromUrl: () => new THREE.Texture() },
  }
)
const equipment = loadModule<typeof import('../src/renderer/features/watcher/entity/equipment')>(
  'src/renderer/features/watcher/entity/equipment.ts',
  {
    './shield': shield,
    './data': { entityData: { armor: { humanoid: { iron: 0 } } } },
    './model': modelTools,
    './textures': { loadTexture: () => new THREE.Texture() },
    './itemMesh': { buildItemMesh: () => assert.fail('a held shield must not use its inventory sprite') },
  }
)
const meshAt = (group: THREE.Object3D, index = 0) =>
  group.children[index] as THREE.Mesh<THREE.BufferGeometry, THREE.Material>

test('shield has a native plate and a handle behind it', () => {
  const mesh = shield.createShieldGeometry()
  mesh.computeBoundingBox()
  const bounds = mesh.boundingBox!
  assert.deepEqual(bounds.getSize(new THREE.Vector3()).toArray(), [12, 22, 7])
  assert.equal(bounds.min.z, -2)
  assert.equal(bounds.max.z, 5)
  assert.equal(mesh.getAttribute('position').count, 48)
  mesh.dispose()
})
test('left and right grips mirror outward without scaling the shield down', () => {
  const left = shield.buildHeldShield(1)
  const right = shield.buildHeldShield(-1)
  assert.equal(left.rotation.y, -right.rotation.y)
  assert.equal(left.position.x, -right.position.x)
  assert.deepEqual(meshAt(left).scale.toArray(), [1, 1, 1])
  assert.equal(meshAt(left).position.y, -2)
  for (const holder of [left, right]) {
    meshAt(holder).geometry.dispose()
    meshAt(holder).material.dispose()
  }
})
test('offhand shield attaches to the left palm using the dedicated grip', () => {
  const arm = new THREE.Group()
  const model = fake<MobModel>({
    bones: new Map([['leftarm', arm]]),
    boneData: new Map([['leftarm', { cubes: [{ origin: [4, 12, -2], size: [4, 12, 4] }] }]]),
    pivots: new Map([['leftarm', new THREE.Vector3(5, 22, 0)]]),
    materials: [],
  })
  equipment.addEquipment(model, { offhand: { name: 'shield' } })
  assert.equal(arm.children.length, 1)
  assert.equal(arm.children[0].name, 'shield-grip')
  assert.deepEqual(arm.children[0].position.toArray(), [3, -9, 0])
  assert.equal(model.materials.length, 1)
  meshAt(arm.children[0]).geometry.dispose()
  model.materials[0].dispose()
})

test('chestplate sleeves use standard armor UV dimensions on slim skins', () => {
  armorLayers = []
  const boneData = new Map<string, Bone>(
    ['head', 'body', 'rightarm', 'leftarm', 'rightleg', 'leftleg'].map((name) => [name, fake<Bone>({ name })])
  )
  boneData.set(
    'body',
    fake<Bone>({ name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4] }] })
  )
  boneData.set(
    'leftarm',
    fake<Bone>({ name: 'leftArm', pivot: [5, 22, 0], cubes: [{ origin: [4, 12, -2], size: [3, 12, 4] }] })
  )
  boneData.set(
    'rightarm',
    fake<Bone>({ name: 'rightArm', pivot: [-5, 22, 0], cubes: [{ origin: [-7, 12, -2], size: [3, 12, 4] }] })
  )
  equipment.addEquipment(fake<MobModel>({ boneData, bones: new Map(), materials: [] }), {
    chest: { name: 'iron_chestplate' },
  })
  const sleeves = armorLayers.filter((bone) => /arm/i.test(bone.name))
  assert.equal(sleeves.length, 2)
  for (const bone of sleeves) {
    assert.equal(bone.cubes?.[0].size[0], 4)
    assert.equal(bone.cubes?.[0].inflate, 1)
    assert.equal(bone.cubes?.[0].uv.join(','), '40,16')
  }
  assert.equal(sleeves.find((bone) => bone.name === 'rightArm')?.cubes?.[0].origin[0], -8)
  assert.equal(sleeves.find((bone) => bone.name === 'leftArm')?.cubes?.[0].origin[0], 4)
  assert.equal(boneData.get('leftarm')?.cubes?.[0].size[0], 3)
  assert.equal(boneData.get('rightarm')?.cubes?.[0].origin[0], -7)
})
