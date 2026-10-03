// Builds the textures the app needs from minecraft-assets, so the app itself doesn't ship the package:
// - src/generated/itemIcons.json: a flat 16×16 icon for each item, and for full-cube blocks the
//   top/left/right textures so the inventory can draw them as 3D cubes like the game.
// - src/generated/blockModels.json: every block's states and model elements, for the 3D watcher.
// - src/generated/entityModels.json: mob geometry and textures, for the 3D watcher.
// Run with `node scripts/generate-assets.js` after updating minecraft-assets.
const fs = require('node:fs')
const path = require('node:path')

const VERSION = '26.1'
const dataDir = path.join(
  path.dirname(require.resolve('minecraft-assets/package.json')),
  'minecraft-assets/data',
  VERSION
)
const models = require(path.join(dataDir, 'blocks_models.json'))
const textureContent = require(path.join(dataDir, 'texture_content.json'))
const itemsTextures = require(path.join(dataDir, 'items_textures.json'))
const blockStates = require(path.join(dataDir, 'blocks_states.json'))
const outDir = path.join(__dirname, '../src/generated')

// Items drawn from a 3D entity model in game. minecraft-assets gives them an unrelated stand-in texture
// (the shield is dark oak planks), so they get a hand-made icon or none.
// The shield is the front face cropped from entity/shield/shield_base_nopattern.png (12×22 at 1,1).
const OVERRIDES = {
  shield:
    'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'icons/shield.png')).toString('base64'),
}

// Inventory tints for grayscale textures (grass and leaves are colored per biome in game).
const tintFor = (name) => {
  if (name.includes('spruce')) return '#619961'
  if (name.includes('birch')) return '#80a755'
  if (name.includes('leaves') || name === 'vine') return '#59ae30'
  return '#79c05a'
}

const modelName = (ref) =>
  String(ref)
    .replace(/^minecraft:/, '')
    .replace(/^block\//, '')
const textureName = (ref) => {
  const value = typeof ref === 'object' && ref ? ref.sprite : ref
  return value
    ? String(value)
        .replace(/^minecraft:/, '')
        .replace(/^block\//, '')
    : null
}

// Walks parents collecting texture variables (child wins) and the nearest elements list.
const resolveModel = (name) => {
  const textures = {}
  let elements = null
  let current = models[name]
  let guard = 0
  while (current && guard++ < 20) {
    for (const [key, value] of Object.entries(current.textures ?? {})) {
      if (!(key in textures)) textures[key] = value
    }
    if (!elements && current.elements) elements = current.elements
    current = current.parent ? models[modelName(current.parent)] : null
  }
  const lookup = (ref, depth = 0) => {
    if (typeof ref === 'string' && ref.startsWith('#') && depth < 10) {
      return lookup(textures[ref.slice(1)], depth + 1)
    }
    return textureName(ref)
  }
  return { elements, lookup }
}

// A deduplicated list of data URLs; everything else refers to textures by index.
const makeTextureTable = () => {
  const list = []
  const ids = new Map()
  const add = (dataUrl) => {
    let id = ids.get(dataUrl)
    if (id === undefined) {
      id = list.length
      list.push(dataUrl)
      ids.set(dataUrl, id)
    }
    return id
  }
  return { list, add }
}

const blockTexture = (name) => {
  const file = path.join(dataDir, 'blocks', `${name}.png`)
  return fs.existsSync(file) ? 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') : null
}

const isFullCube = (element) =>
  element.from.every((value) => value === 0) && element.to.every((value) => value === 16)

// The game's inventory view shows the top, the north face on the left and the west face on the right.
// Face textures of a full-cube model as [{ dataUrl, tinted }] in the given side order, or null.
const cubeFaces = (model, sides) => {
  if (!models[model]) return null
  const { elements, lookup } = resolveModel(model)
  const element = elements?.length ? elements[0] : null
  if (!element || !isFullCube(element)) return null
  const faces = []
  for (const side of sides) {
    const face = element.faces?.[side]
    const texture = face && lookup(face.texture)
    const dataUrl = texture && blockTexture(texture)
    if (!dataUrl) return null
    faces.push({ dataUrl, tinted: face.tintindex !== undefined })
  }
  return faces
}

const contentByName = new Map(
  textureContent.filter((entry) => entry.texture).map((entry) => [entry.name, entry.texture])
)

// A stand-in shares no word with the item, e.g. shield → dark_oak_planks, zombie_head → soul_sand.
const isStandIn = (name) => {
  const texture = itemsTextures.find((entry) => entry.name === name)?.texture
  if (!texture) return false
  const words = new Set(name.split('_'))
  // Compare by file name only; folders vary ("item/", "items/", "block/", …).
  return !String(texture)
    .split('/')
    .pop()
    .split('_')
    .some((word) => words.has(word))
}

const writeJson = (file, data, summary) => {
  const outFile = path.join(outDir, file)
  fs.writeFileSync(outFile, JSON.stringify(data))
  console.log(
    `Wrote ${path.relative(process.cwd(), outFile)}: ${summary}, ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`
  )
}

// Item icons.
{
  const textures = makeTextureTable()
  const flat = {}
  const cubes = {}
  for (const { name } of itemsTextures) {
    // The game's inventory view shows the top, the north face on the left and the west face on the right.
    const faces = cubeFaces(name, ['up', 'north', 'west'])
    if (faces) {
      const tint = faces.some((face) => face.tinted) ? tintFor(name) : undefined
      cubes[name] = {
        faces: faces.map((face) => textures.add(face.dataUrl)),
        tinted: faces.map((face) => face.tinted),
        tint,
      }
      continue
    }
    if (OVERRIDES[name]) {
      flat[name] = textures.add(OVERRIDES[name])
    } else if (contentByName.has(name) && !isStandIn(name)) {
      flat[name] = textures.add(contentByName.get(name))
    }
  }
  writeJson(
    'itemIcons.json',
    { version: VERSION, textures: textures.list, flat, cubes },
    `${Object.keys(cubes).length} cubes, ${Object.keys(flat).length} flat icons`
  )
}

// Block models for the watcher: every block's blockstate variants and the elements of each model, so the
// renderer can draw real shapes (stairs, hoppers, torches, flowers, …) facing the right way.
{
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
      textures.push({ src: 'data:image/png;base64,' + png.toString('base64'), size: png.readUInt32BE(16) })
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

  // Chests are drawn as entities in game, so their block model is empty. This builds one from the
  // chest entity texture (64×64): a base, a lid and the latch, laid out like Java's model boxes.
  // `half` is 'left'/'right' for double chests. A left half's partner is clockwise of its facing, so in
  // the north-facing model it reaches the +x edge (the right half the -x edge), and each half carries
  // one pixel of the latch on the side where the two meet.
  const chestModel = (texture, half = 'single') => {
    const box = (u, v, [w, h, d], from) => {
      const to = [from[0] + w, from[1] + h, from[2] + d]
      // UVs in the 64px texture, scaled to the 0-16 range block models use.
      const uv = (u0, v0, u1, v1) => [u0 / 4, v0 / 4, u1 / 4, v1 / 4]
      return {
        from,
        to,
        faces: {
          0: { t: texture, uv: uv(u + d + w, v, u + d, v + d) },
          1: { t: texture, uv: uv(u + d + 2 * w, v + d, u + d + w, v) },
          2: { t: texture, uv: uv(u + d, v + d + h, u + d + w, v + d) },
          3: { t: texture, uv: uv(u + 2 * d + w, v + d + h, u + 2 * d + 2 * w, v + d) },
          4: { t: texture, uv: uv(u, v + d + h, u + d, v + d) },
          5: { t: texture, uv: uv(u + d + w, v + d + h, u + 2 * d + w, v + d) },
        },
      }
    }
    if (half === 'single') {
      return [
        box(0, 19, [14, 10, 14], [1, 0, 1]),
        box(0, 0, [14, 5, 14], [1, 9, 1]),
        box(0, 0, [2, 4, 1], [7, 7, 0]),
      ]
    }
    const x = half === 'left' ? 1 : 0
    return [
      box(0, 19, [15, 10, 14], [x, 0, 1]),
      box(0, 0, [15, 5, 14], [x, 9, 1]),
      box(0, 0, [1, 4, 1], [half === 'left' ? 15 : 0, 7, 0]),
    ]
  }
  // Chest texture prefixes; ender chests are never double.
  const CHESTS = { chest: 'normal', trapped_chest: 'trapped', ender_chest: 'ender' }
  const FACING_Y = { north: 0, east: 90, south: 180, west: 270 }

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
  const applyList = (entry) =>
    (Array.isArray(entry) ? entry.slice(0, 1) : [entry])
      .map((variant) => {
        const m = modelId(modelName(variant.model))
        return m === undefined
          ? null
          : { m, ...(variant.x ? { x: variant.x } : {}), ...(variant.y ? { y: variant.y } : {}) }
      })
      .filter(Boolean)
  const parseKey = (key) => Object.fromEntries(key ? key.split(',').map((pair) => pair.split('=')) : [])

  const blocks = {}
  for (const [name, state] of Object.entries(blockStates)) {
    let entry
    if (CHESTS[name]) {
      const halves = name === 'ender_chest' ? ['single'] : ['single', 'left', 'right']
      const variants = []
      for (const half of halves) {
        const texture = textureId(`entity/chest/${CHESTS[name]}${half === 'single' ? '' : `_${half}`}`)
        const m = models.push(chestModel(texture, half)) - 1
        for (const [facing, y] of Object.entries(FACING_Y)) {
          variants.push([
            half === 'single' ? { facing } : { facing, type: half },
            [{ m, ...(y ? { y } : {}) }],
          ])
        }
      }
      // Specific halves first, so a single chest's {facing} doesn't match a double chest's state.
      entry = { variants: variants.reverse() }
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
        !CHESTS[name] &&
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

// Mob models for the watcher. The geometry is prismarine-viewer's entities.json (MIT, Bedrock-style
// bones and cubes); the textures come from this version's assets, where many have moved since.
{
  const entities = require('./vendor/prismarine-viewer-entities.json')
  const entityDir = path.join(dataDir, 'entity')
  const allTextures = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.png'))
        allTextures.push(path.relative(entityDir, full).replace(/\.png$/, ''))
    }
  }
  walk(entityDir)

  // Mobs whose listed textures are only overlays or variants that no longer exist under any similar name.
  const TEXTURE_OVERRIDES = {
    villager: 'textures/entity/villager/villager',
    zombie_villager: 'textures/entity/zombie_villager/zombie_villager',
    armor_stand: 'textures/entity/armorstand/wood',
    sheep: 'textures/entity/sheep/sheep',
    donkey: 'textures/entity/horse/donkey',
    mule: 'textures/entity/horse/mule',
    skeleton_horse: 'textures/entity/horse/horse_skeleton',
    zombie_horse: 'textures/entity/horse/horse_zombie',
    ocelot: 'textures/entity/cat/ocelot',
  }
  const SKIP = /baby|overlay|outer|eyes|saddle|armor|collar|markings|decor|profession|level|type\//

  // Older asset versions, newest first. Mobs redesigned since the geometry was made (cows, chickens in
  // 1.21.5) need the texture from before the change, since a new texture layout won't fit the old model.
  const assetsRoot = path.dirname(dataDir)
  const olderVersions = fs
    .readdirSync(assetsRoot)
    .filter((name) => /^\d/.test(name) && name !== VERSION)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

  // "textures/entity/cow/red_mooshroom" → a path to the texture: the same path in this or an older
  // version, otherwise the closest name now (e.g. cow/mooshroom_red): a name that extends it, or one
  // with the same words in another order.
  const findTexture = (ref) => {
    const wanted = ref.replace(/^textures\/entity\//, '')
    if (allTextures.includes(wanted)) return path.join(entityDir, `${wanted}.png`)
    for (const version of olderVersions) {
      const file = path.join(assetsRoot, version, 'entity', `${wanted}.png`)
      if (fs.existsSync(file)) return file
    }
    const base = wanted.split('/').pop()
    const words = base.split('_').sort().join('_')
    const candidates = allTextures
      .filter((file) => {
        const fileBase = file.split('/').pop()
        return (
          fileBase === base ||
          fileBase.startsWith(`${base}_`) ||
          fileBase.split('_').sort().join('_') === words
        )
      })
      .filter((file) => !SKIP.test(file))
      .sort((a, b) => a.length - b.length)
    return candidates[0] ? path.join(entityDir, `${candidates[0]}.png`) : null
  }

  const textures = []
  const out = {}
  const missing = []
  const sources = {}
  for (const [type, entity] of Object.entries(entities)) {
    const geometry = entity.geometry?.default
    // Mobs with color variants (horses, cats, …) have no "default" texture; any variant will do.
    const refs = [entity.textures?.default, ...Object.values(entity.textures ?? {})].filter(Boolean)
    const file = [TEXTURE_OVERRIDES[type], ...refs].filter(Boolean).map(findTexture).find(Boolean)
    if (!geometry?.bones || !file) {
      missing.push(type)
      continue
    }
    const png = fs.readFileSync(file)
    sources[type] = path.relative(assetsRoot, file)
    textures.push({
      src: 'data:image/png;base64,' + png.toString('base64'),
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
    })
    out[type] = { texture: textures.length - 1, bones: geometry.bones }
  }

  // Villager outfits: a biome layer and a profession layer drawn over the base skin, in the order of the
  // game's registries (the ids the server sends).
  const VILLAGER_TYPES = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga']
  const PROFESSIONS = [
    'none',
    'armorer',
    'butcher',
    'cartographer',
    'cleric',
    'farmer',
    'fisherman',
    'fletcher',
    'leatherworker',
    'librarian',
    'mason',
    'nitwit',
    'shepherd',
    'toolsmith',
    'weaponsmith',
  ]
  const layers = {}
  for (const type of ['villager', 'zombie_villager']) {
    const layer = (folder, name) => {
      const file = path.join(entityDir, type, folder, `${name}.png`)
      if (!fs.existsSync(file)) return null
      textures.push({ src: 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') })
      return textures.length - 1
    }
    layers[type] = {
      types: VILLAGER_TYPES.map((name) => layer('type', name)),
      professions: PROFESSIONS.map((name) => layer('profession', name)),
    }
  }

  // SHOW_SOURCES=1 lists which texture file each mob ended up with.
  if (process.env.SHOW_SOURCES) console.log(sources)
  writeJson(
    'entityModels.json',
    { version: VERSION, textures, entities: out, layers },
    `${Object.keys(out).length} mobs${missing.length ? ` (no model or texture: ${missing.join(', ')})` : ''}`
  )
}
