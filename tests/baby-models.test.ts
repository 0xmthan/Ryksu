import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { entityData } from '../src/utils/entity/data'
import { buildEntityModel } from '../src/utils/entity/appearance'
import { getMotion } from '../src/bot/entityView'
import { Vec3 } from 'vec3'
import minecraftData from 'minecraft-data'
import type { Bot } from 'mineflayer'
import type { MotionEntity } from '../src/types'
import { fake, mob } from './fakes'

const build = (fields: Partial<MotionEntity>) => {
  const model = buildEntityModel(mob(fields))
  assert.ok(model, fields.type ?? 'model')
  return model
}

test('updated babies use dedicated geometry and textures at their native size', () => {
  const original = THREE.TextureLoader.prototype.load
  THREE.TextureLoader.prototype.load = () => new THREE.Texture()
  try {
    const babies = Object.entries(entityData.entities).filter(([, entry]) => entry.baby)
    assert.equal(babies.length, 38)
    for (const [type, entry] of babies) {
      const model = build({ type, baby: true })
      assert.equal(model.entry, entry.baby, type)
      assert.equal(model.root.scale.x, 1, type)
      assert.notEqual(entry.texture, entry.baby?.texture, type)
      model.root.traverse((mesh) => {
        if (!(mesh instanceof THREE.Mesh)) return
        const uv = mesh.geometry.getAttribute('uv')
        const position = mesh.geometry.getAttribute('position')
        for (let i = 0; i < uv.count; i++) {
          assert.ok(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)), type)
          // Flat wings and flippers have unused, zero-area box faces outside the atlas.
          const face = Math.floor(i / 4) * 4
          const a = new THREE.Vector3().fromBufferAttribute(position, face)
          const b = new THREE.Vector3().fromBufferAttribute(position, face + 1)
          const c = new THREE.Vector3().fromBufferAttribute(position, face + 2)
          if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-8) continue
          assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1.001, `${type} u`)
          assert.ok(uv.getY(i) >= 0 && uv.getY(i) <= 1.001, `${type} v`)
        }
      })
    }
    const sheep = build({ type: 'sheep', baby: true, wool: '#8932b8' })
    assert.equal(sheep.materials.length, 2)
    assert.ok(sheep.materials[1].color.equals(new THREE.Color('#8932b8')))
    // Java uses the exact baby body geometry for fleece, with no adult-style inflation.
    const bodyBounds = new THREE.Box3()
    const fleeceBounds = new THREE.Box3()
    sheep.root.updateMatrixWorld(true)
    sheep.root.traverse((mesh) => {
      if (!(mesh instanceof THREE.Mesh)) return
      const bounds = new THREE.Box3().setFromObject(mesh)
      if (mesh.material === sheep.skin) bodyBounds.union(bounds)
      else fleeceBounds.union(bounds)
    })
    assert.ok(bodyBounds.equals(fleeceBounds))
    assert.equal(bodyBounds.getSize(new THREE.Vector3()).y, 13 / 16)
    assert.equal(sheep.materials[1].polygonOffset, true)
    for (const type of ['cat', 'wolf', 'horse', 'rabbit', 'llama', 'panda', 'pig', 'chicken', 'mooshroom']) {
      const entry = entityData.entities[type]
      assert.deepEqual(
        Object.keys(entry.baby?.variants ?? {}).sort(),
        Object.keys(entry.variants ?? {}).sort(),
        type
      )
    }
    const fallback = build({ type: 'villager' })
    assert.equal(fallback.entry, entityData.entities.villager)
    const armored = build({
      type: 'zombie',
      baby: true,
      equipment: {
        head: { name: 'diamond_helmet' },
        chest: { name: 'diamond_chestplate' },
        legs: { name: 'diamond_leggings' },
        feet: { name: 'diamond_boots' },
      },
    })
    assert.equal(armored.materials.length, 5)
    const babyArmor = entityData.armor.humanoid_baby.diamond
    assert.equal(armored.materials[1].map, armored.materials[4].map)
    assert.ok(babyArmor !== undefined)
  } finally {
    THREE.TextureLoader.prototype.load = original
  }
})

test('server sheep age metadata selects the new model and switches back on growth', () => {
  const original = THREE.TextureLoader.prototype.load
  THREE.TextureLoader.prototype.load = () => new THREE.Texture()
  try {
    for (const version of ['26.1', '1.21.11']) {
      const registry = minecraftData(version)
      const keys = registry.entitiesByName.sheep.metadataKeys ?? []
      const sheep = {
        id: 2,
        name: 'sheep',
        type: 'animal',
        position: new Vec3(1, 0, 0),
        metadata: { [keys.indexOf('baby')]: true, [keys.indexOf('wool')]: 10 } as Record<number, unknown>,
      }
      const self = { id: 1, name: 'player', position: new Vec3(0, 0, 0) }
      const bot = fake<Bot>({ registry, entity: self, entities: { 1: self, 2: sheep } })
      const baby = getMotion(bot)?.entities[0]
      assert.ok(baby)
      assert.equal(baby.baby, true, version)
      assert.equal(buildEntityModel(baby)?.entry, entityData.entities.sheep.baby, version)
      sheep.metadata[keys.indexOf('baby')] = false
      const adult = getMotion(bot)?.entities[0]
      assert.ok(adult)
      assert.equal(adult.baby, undefined, version)
      assert.equal(buildEntityModel(adult)?.entry, entityData.entities.sheep, version)
    }
  } finally {
    THREE.TextureLoader.prototype.load = original
  }
})
