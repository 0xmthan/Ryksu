// Builds src/generated/itemIcons.json from minecraft-assets: a flat 16×16 icon for each item, and for
// full-cube blocks the top/left/right textures so the dashboard can draw them as 3D cubes like the game.
// Run with `node scripts/generate-item-icons.js` after updating minecraft-assets.
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
const outFile = path.join(__dirname, '../src/generated/itemIcons.json')

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

const textures = []
const textureIds = new Map()
const addTexture = (dataUrl) => {
  let id = textureIds.get(dataUrl)
  if (id === undefined) {
    id = textures.length
    textures.push(dataUrl)
    textureIds.set(dataUrl, id)
  }
  return id
}

const blockTexture = (name) => {
  const file = path.join(dataDir, 'blocks', `${name}.png`)
  return fs.existsSync(file) ? 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') : null
}

const isFullCube = (element) =>
  element.from.every((value) => value === 0) && element.to.every((value) => value === 16)

// The game's inventory view shows the top, the north face on the left and the west face on the right.
const cubeFaces = (name) => {
  if (!models[name]) return null
  const { elements, lookup } = resolveModel(name)
  const element = elements?.length ? elements[0] : null
  if (!element || !isFullCube(element)) return null
  const faces = []
  for (const side of ['up', 'north', 'west']) {
    const face = element.faces?.[side]
    const texture = face && lookup(face.texture)
    const dataUrl = texture && blockTexture(texture)
    if (!dataUrl) return null
    faces.push({ id: addTexture(dataUrl), tinted: face.tintindex !== undefined })
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
  return !textureName(texture)
    .replace(/^item\//, '')
    .split('_')
    .some((word) => words.has(word))
}

const flat = {}
const cubes = {}
for (const { name } of itemsTextures) {
  const faces = cubeFaces(name)
  if (faces) {
    const tint = faces.some((face) => face.tinted) ? tintFor(name) : undefined
    cubes[name] = { faces: faces.map((face) => face.id), tinted: faces.map((face) => face.tinted), tint }
    continue
  }
  if (OVERRIDES[name]) {
    flat[name] = addTexture(OVERRIDES[name])
  } else if (contentByName.has(name) && !isStandIn(name)) {
    flat[name] = addTexture(contentByName.get(name))
  }
}

fs.writeFileSync(outFile, JSON.stringify({ version: VERSION, textures, flat, cubes }))
console.log(
  `Wrote ${path.relative(process.cwd(), outFile)}: ${Object.keys(cubes).length} cubes, ` +
    `${Object.keys(flat).length} flat icons, ${textures.length} textures, ` +
    `${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`
)
