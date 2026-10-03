// Chest and bed models for the watcher, rebuilt from the game's entity models (see javaModel.js).
const { rotation, translation, entityModel } = require('./javaModel')

// The renderers' turn for each facing (Direction.toYRot()).
const Y_ROT = { south: 0, west: 90, north: 180, east: 270 }

// ChestModel; the front faces south (+z) before the renderer turns it. A left half's partner is
// clockwise of its facing, so unturned it reaches the -x edge (the right half the +x edge).
const CHEST_BOXES = {
  single: [
    { uv: [0, 19], from: [1, 0, 1], size: [14, 10, 14] },
    { uv: [0, 0], from: [1, 0, 0], size: [14, 5, 14], offset: [0, 9, 1] },
    { uv: [0, 0], from: [7, -2, 14], size: [2, 4, 1], offset: [0, 9, 1] },
  ],
  left: [
    { uv: [0, 19], from: [0, 0, 1], size: [15, 10, 14] },
    { uv: [0, 0], from: [0, 0, 0], size: [15, 5, 14], offset: [0, 9, 1] },
    { uv: [0, 0], from: [0, -2, 14], size: [1, 4, 1], offset: [0, 9, 1] },
  ],
  right: [
    { uv: [0, 19], from: [1, 0, 1], size: [15, 10, 14] },
    { uv: [0, 0], from: [1, 0, 0], size: [15, 5, 14], offset: [0, 9, 1] },
    { uv: [0, 0], from: [15, -2, 14], size: [1, 4, 1], offset: [0, 9, 1] },
  ],
}
const chestTransforms = (facing) => [
  translation(8, 8, 8),
  rotation('y', -Y_ROT[facing]),
  translation(-8, -8, -8),
]
// Chest texture prefixes; ender chests are never double.
const CHESTS = { chest: 'normal', trapped_chest: 'trapped', ender_chest: 'ender' }
for (const [stage, prefix] of [
  ['', 'copper'],
  ['exposed_', 'copper_exposed'],
  ['weathered_', 'copper_weathered'],
  ['oxidized_', 'copper_oxidized'],
]) {
  CHESTS[`${stage}copper_chest`] = prefix
  CHESTS[`waxed_${stage}copper_chest`] = prefix
}

// BedRenderer's head and foot models: the mattress is a 16×16×6 box laid flat, the legs 3×3×3.
const BED_BOXES = {
  head: [
    { uv: [0, 0], from: [0, 0, 0], size: [16, 16, 6] },
    { uv: [50, 6], from: [0, 6, 0], size: [3, 3, 3], rotation: [90, 0, 90] },
    { uv: [50, 18], from: [-16, 6, 0], size: [3, 3, 3], rotation: [90, 0, 180] },
  ],
  foot: [
    { uv: [0, 22], from: [0, 0, 0], size: [16, 16, 6] },
    { uv: [50, 0], from: [0, 6, -16], size: [3, 3, 3], rotation: [90, 0, 0] },
    { uv: [50, 12], from: [-16, 6, -16], size: [3, 3, 3], rotation: [90, 0, 270] },
  ],
}
const bedTransforms = (facing) => [
  translation(0, 9, 0),
  rotation('x', 90),
  translation(8, 8, 8),
  rotation('z', 180 + Y_ROT[facing]),
  translation(-8, -8, -8),
]

// Every state of a block entity, as [state, model] variants built per facing and part. New models are
// pushed onto `models`; `textureId` resolves a texture path to its index.
const entityVariants = (models, parts, partKey, textureFor, boxes, transforms) => {
  const variants = []
  for (const part of parts) {
    const texture = textureFor(part)
    if (texture === undefined) continue
    for (const facing of Object.keys(Y_ROT)) {
      const m = models.push(entityModel(texture, boxes[part], transforms(facing))) - 1
      variants.push([partKey ? { facing, [partKey]: part } : { facing }, [{ m }]])
    }
  }
  return variants
}

const isBlockEntity = (name) => Boolean(CHESTS[name]) || name.endsWith('_bed')

// The blockstate entry for a chest or bed, or null for any other block.
const blockEntityEntry = (name, models, textureId) => {
  if (CHESTS[name]) {
    const double = name !== 'ender_chest'
    const variants = entityVariants(
      models,
      double ? ['single', 'left', 'right'] : ['single'],
      double ? 'type' : null,
      (half) => textureId(`entity/chest/${CHESTS[name]}${half === 'single' ? '' : `_${half}`}`),
      CHEST_BOXES,
      chestTransforms
    )
    return { variants }
  }
  if (name.endsWith('_bed')) {
    const texture = textureId(`entity/bed/${name.replace(/_bed$/, '')}`)
    return {
      variants: entityVariants(models, ['head', 'foot'], 'part', () => texture, BED_BOXES, bedTransforms),
    }
  }
  return null
}

module.exports = { blockEntityEntry, isBlockEntity }
