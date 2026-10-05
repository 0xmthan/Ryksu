const test = require('node:test')
const assert = require('node:assert/strict')
const THREE = require('three')
const { entityVariant } = require('../src/bot/entityVariants')
const { buildEntityModel, lookOf } = require('../src/utils/entity/appearance.ts')
const { dyeSheepPixels } = require('../src/utils/entity/textures.ts')

test('all sheep dyes survive shearing and wool regrowth', () => {
  const originalLoad = THREE.TextureLoader.prototype.load
  THREE.TextureLoader.prototype.load = () => new THREE.Texture()
  try {
    for (let dye = 0; dye < 16; dye++) {
      const grown = entityVariant({}, 'sheep', () => dye)
      const sheared = entityVariant({}, 'sheep', () => dye | 0x10)
      assert.equal(sheared.wool, null)
      assert.equal(sheared.shearedColor, grown.wool)
      const entity = { type: 'sheep', kind: 'mob', ...sheared }
      const model = buildEntityModel(entity)
      const expected = new THREE.Color('white')
      assert.ok(model.skin.color.equals(expected))
      assert.ok(model.skin.userData.baseColor.equals(expected))
      assert.equal(model.materials.length, 1)
      const regrown = buildEntityModel({ ...entity, ...grown })
      assert.equal(regrown.materials.length, 2)
      assert.ok(regrown.skin.color.equals(new THREE.Color('white')))
      assert.notEqual(lookOf(entity), lookOf({ ...entity, ...grown }))
      assert.notEqual(lookOf(entity), lookOf({ ...entity, shearedColor: '#123456' }))
    }
  } finally {
    THREE.TextureLoader.prototype.load = originalLoad
  }
})

test('sheared dye colors stubble while preserving face, skin and hooves', () => {
  const pixels = new Uint8ClampedArray(64 * 32 * 4)
  const samples = [[8, 8, [255, 255, 255, 255]], [32, 16, [220, 220, 220, 255]],
    [33, 16, [150, 120, 100, 255]], [8, 28, [80, 75, 70, 255]]]
  for (const [x, y, rgba] of samples) pixels.set(rgba, (y * 64 + x) * 4)
  dyeSheepPixels(pixels, 64, '#8932b8')
  for (const [x, y, rgba] of samples) {
    const actual = Array.from(pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4))
    assert.deepEqual(actual, x === 32 ? [118, 43, 159, 255] : rgba)
  }
})
