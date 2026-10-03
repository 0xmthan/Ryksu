// Shared paths and helpers for the asset generators.
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
const outDir = path.join(__dirname, '../../src/generated')

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

const writeJson = (file, data, summary) => {
  const outFile = path.join(outDir, file)
  fs.writeFileSync(outFile, JSON.stringify(data))
  console.log(
    `Wrote ${path.relative(process.cwd(), outFile)}: ${summary}, ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`
  )
}

const assetsRoot = path.dirname(dataDir)
const pngDataUrl = (png) => 'data:image/png;base64,' + png.toString('base64')

module.exports = {
  VERSION,
  dataDir,
  assetsRoot,
  models,
  textureContent,
  itemsTextures,
  blockStates,
  tintFor,
  modelName,
  textureName,
  resolveModel,
  makeTextureTable,
  blockTexture,
  isFullCube,
  writeJson,
  pngDataUrl,
}
