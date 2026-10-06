import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { skinUrl, capeUrl } from '../src/bot/profileTextures'
import type { MobModel } from '../src/utils/entity/model'
import { fake } from './fakes'
import { loadModule } from './loadModule'

let fetchTexture: (url: string) => Promise<string | null> = async () => 'data:image/png;base64,test'
const cape = loadModule<typeof import('../src/utils/entity/cape')>(
  'src/utils/entity/cape.ts',
  {
    './model': {
      mobMaterial: (map: THREE.Texture) => {
        const material = new THREE.MeshLambertMaterial({ map })
        material.userData.sharedMap = true
        return material
      },
    },
    './textures': { textureFromUrl: () => new THREE.Texture() },
  },
  { window: { electronAPI: { bot: { getSkin: (url: string) => fetchTexture(url) } } } }
)
// The part of a mob model a cape uses.
const capeModel = (attachment: THREE.Group) =>
  fake<MobModel>({ bones: new Map([['cape', attachment]]), materials: [] })

test('profile cape URLs accept Mojang textures and normalize HTTP', () => {
  const player = { skinData: { url: 'http://textures.minecraft.net/texture/abc123', capeUrl: 'http://textures.minecraft.net/texture/deadbeef' } }
  assert.equal(skinUrl(player), 'https://textures.minecraft.net/texture/abc123')
  assert.equal(capeUrl(player), 'https://textures.minecraft.net/texture/deadbeef')
  assert.equal(capeUrl(player, 126), null)
  assert.equal(capeUrl(player, 127), 'https://textures.minecraft.net/texture/deadbeef')
  assert.equal(capeUrl({ skinData: { capeUrl: 'https://example.com/cape.png' } }), null)
  assert.equal(capeUrl({}), null)
})
test('cape geometry hangs from the shoulders behind the player and uses its own atlas', () => {
  const mesh = cape.createCapeGeometry()
  mesh.computeBoundingBox()
  const bounds = mesh.boundingBox!
  const size = bounds.getSize(new THREE.Vector3())
  assert.ok(Math.abs(size.x - 10) < 0.0001)
  assert.ok(Math.abs(size.y - 16) < 0.0001)
  assert.ok(Math.abs(size.z - 1) < 0.0001)
  assert.equal(bounds.max.y, 0)
  assert.equal(bounds.min.y, -16)
  assert.ok(bounds.min.z > -0.0001)
  const uv = mesh.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) {
    assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 22 / 64)
    assert.ok(uv.getY(i) >= 0 && uv.getY(i) <= 17 / 32)
  }
  mesh.dispose()
})
test('walking smoothly lifts the cape backward and it settles when standing', () => {
  const attachment = new THREE.Group()
  cape.animateCape(attachment, 0, 0, 1, 1 / 60)
  assert.ok(attachment.rotation.x < 0 && attachment.rotation.x > -0.47)
  for (let i = 0; i < 60; i++) cape.animateCape(attachment, 0, 0, 1, 1 / 60)
  assert.ok(attachment.rotation.x < -0.45)
  for (let i = 0; i < 60; i++) cape.animateCape(attachment, 0, 0, 0, 1 / 60)
  assert.ok(Math.abs(attachment.rotation.x + 0.12) < 0.01)
})
test('a cape texture finishing after disposal never revives the model', async () => {
  let resolve: (url: string) => void = () => {}
  fetchTexture = () => new Promise((done) => (resolve = done))
  const attachment = new THREE.Group()
  const model = capeModel(attachment)
  cape.addCape(model, 'https://textures.minecraft.net/texture/deadbeef')
  const mesh = attachment.children[0] as THREE.Mesh
  model.materials[0].dispose()
  resolve('data:image/png;base64,test')
  await Promise.resolve()
  assert.equal(mesh.visible, false)
  mesh.geometry.dispose()
})

test('cape sits close to the jacket and leaves additional clearance for chest armor', () => {
  fetchTexture = async () => null
  for (const [armored, offset] of [[false, 2.4], [true, 2.65]] as const) {
    const attachment = new THREE.Group()
    attachment.position.z = 3
    const model = capeModel(attachment)
    cape.addCape(model, 'https://textures.minecraft.net/texture/deadbeef', armored)
    assert.equal(attachment.position.z, offset)
    model.materials[0].map?.dispose()
    model.materials[0].dispose()
    ;(attachment.children[0] as THREE.Mesh).geometry.dispose()
  }
})
