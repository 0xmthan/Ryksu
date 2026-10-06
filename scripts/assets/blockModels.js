const fs = require('node:fs')
const path = require('node:path')
const {
  VERSION,
  dataDir,
  blockStates,
  tintFor,
  modelName,
  textureName,
  resolveModel,
  isFullCube,
  writeJson,
  pngDataUrl,
} = require('./common')
const { blockEntityEntry, isBlockEntity } = require('./blockEntities')

// Block models for the watcher: every block's blockstate variants and the elements of each model, so the
// renderer can draw real shapes (stairs, hoppers, torches, flowers, …) facing the right way.
module.exports = () => {
  const DIRECTIONS = ['up', 'down', 'north', 'south', 'west', 'east']
  const textures = []
  const textureIds = new Map()

  // Resolves "block/stone", "entity/chest/normal", … to a texture index, or undefined if the file is missing.
  const textureId = (ref) => {
    const name = String(ref).replace(/^minecraft:/, '')
    if (textureIds.has(name)) return textureIds.get(name)
    const [folder, ...rest] = name.split('/')
    const dir = { block: 'blocks', item: 'items', entity: 'entity' }[folder]
    const file = dir && path.join(dataDir, dir, `${rest.join('/')}.png`)
    let id
    if (file && fs.existsSync(file)) {
      const png = fs.readFileSync(file)
      id = textures.length
      // Width from the PNG header; animated textures are a vertical strip of square frames.
      textures.push({ src: pngDataUrl(png), size: png.readUInt32BE(16) })
    }
    textureIds.set(name, id)
    return id
  }

  // Minecraft's automatic UVs for faces that don't list their own, from the element's box.
  const defaultUv = (direction, [x1, y1, z1], [x2, y2, z2]) =>
    ({
      down: [x1, 16 - z2, x2, 16 - z1],
      up: [x1, z1, x2, z2],
      north: [16 - x2, 16 - y2, 16 - x1, 16 - y1],
      south: [x1, 16 - y2, x2, 16 - y1],
      west: [z1, 16 - y2, z2, 16 - y1],
      east: [16 - z2, 16 - y2, 16 - z1, 16 - y1],
    })[direction]

  const models = []
  const modelIds = new Map()

  const compileElements = (elements, lookup) =>
    elements.map((element) => {
      const faces = {}
      for (const [direction, face] of Object.entries(element.faces ?? {})) {
        const texture = lookup(face.texture)
        const id = texture && textureId(texture.includes('/') ? texture : `block/${texture}`)
        if (id === undefined) continue
        faces[DIRECTIONS.indexOf(direction)] = {
          t: id,
          uv: face.uv ?? defaultUv(direction, element.from, element.to),
          ...(face.rotation ? { r: face.rotation } : {}),
          ...(face.cullface
            ? { c: DIRECTIONS.indexOf(face.cullface === 'bottom' ? 'down' : face.cullface) }
            : {}),
          ...(face.tintindex !== undefined ? { tint: 1 } : {}),
        }
      }
      return {
        from: element.from,
        to: element.to,
        ...(element.rotation ? { rot: element.rotation } : {}),
        ...(element.shade === false ? { noShade: 1 } : {}),
        faces,
      }
    })

  // Model elements with textures resolved, deduplicated by model name.
  const modelId = (name) => {
    if (modelIds.has(name)) return modelIds.get(name)
    const { elements, lookup } = resolveModel(name)
    const lookupWithPrefix = (ref) => {
      const value = typeof ref === 'string' && ref.startsWith('#') ? null : ref
      if (value) return String(textureName(value))
      const resolved = lookup(ref)
      return resolved
    }
    const id = elements ? models.push(compileElements(elements, lookupWithPrefix)) - 1 : undefined
    modelIds.set(name, id)
    return id
  }

  const LIQUIDS = {
    water: { texture: 'block/water_still', tint: '#3f76e4' },
    lava: { texture: 'block/lava_still' },
  }
  const liquidModel = (texture) => [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: Object.fromEntries(
        DIRECTIONS.map((_, index) => [index, { t: texture, uv: [0, 0, 16, 16], c: index, tint: 1 }])
      ),
    },
  ]

  const tintColor = (name) => (name === 'redstone_wire' ? '#c81e1e' : tintFor(name))
  // A blockstate entry's models. Several (grass, dirt, stone, sand, …) are alternatives the game picks
  // between per block position, by weight, so the ground doesn't look tiled; the renderer does the same.
  const applyList = (entry) =>
    (Array.isArray(entry) ? entry : [entry])
      .map((variant) => {
        const m = modelId(modelName(variant.model))
        return m === undefined
          ? null
          : {
              m,
              ...(variant.x ? { x: variant.x } : {}),
              ...(variant.y ? { y: variant.y } : {}),
              ...(variant.weight && variant.weight !== 1 ? { w: variant.weight } : {}),
            }
      })
      .filter(Boolean)
  const parseKey = (key) => Object.fromEntries(key ? key.split(',').map((pair) => pair.split('=')) : [])

  const blocks = {}
  for (const [name, state] of Object.entries(blockStates)) {
    /** @type {{ variants?: any[]; multipart?: any[]; tint?: unknown; [key: string]: unknown }} */
    let entry
    if (isBlockEntity(name)) {
      entry = blockEntityEntry(name, models, textureId)
    } else if (LIQUIDS[name]) {
      const m = models.push(liquidModel(textureId(LIQUIDS[name].texture))) - 1
      entry = {
        variants: [[{}, [{ m }]]],
        translucent: 1,
        ...(LIQUIDS[name].tint ? { tint: LIQUIDS[name].tint } : {}),
      }
    } else if (state.variants) {
      entry = {
        variants: Object.entries(state.variants).map(([key, value]) => [parseKey(key), applyList(value)]),
      }
    } else if (state.multipart) {
      entry = { multipart: state.multipart.map((part) => [part.when ?? null, applyList(part.apply)]) }
    } else {
      continue
    }
    const usesTint = [...(entry.variants ?? []), ...(entry.multipart ?? [])].some(([, list]) =>
      list.some(({ m }) =>
        models[m].some((element) => Object.values(element.faces).some((face) => face.tint))
      )
    )
    if (usesTint && !entry.tint) entry.tint = tintColor(name)
    blocks[name] = entry
  }

  // Blocks whose every state is one full 16³ cube; only these (when not see-through) hide their
  // neighbors' faces. The bot side reads this, since minecraft-data counts stairs and slabs as solid.
  const isCube = (m) => models[m].length > 0 && models[m].every(isFullCube)
  const fullCubes = Object.entries(blocks)
    .filter(
      ([name, entry]) =>
        !isBlockEntity(name) &&
        !LIQUIDS[name] &&
        entry.variants?.every(([, list]) => list.length > 0 && list.every(({ m }) => isCube(m)))
    )
    .map(([name]) => name)
  writeJson('fullCubes.json', fullCubes, `${fullCubes.length} full-cube blocks`)

  writeJson(
    'blockModels.json',
    { version: VERSION, textures, models, blocks },
    `${Object.keys(blocks).length} blocks, ${models.length} models, ${textures.length} textures`
  )
}
