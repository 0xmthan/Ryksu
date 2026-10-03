const fs = require('node:fs')
const path = require('node:path')
const {
  VERSION,
  models,
  textureContent,
  itemsTextures,
  tintFor,
  resolveModel,
  makeTextureTable,
  blockTexture,
  isFullCube,
  writeJson,
} = require('./common')

// Items drawn from a 3D entity model in game. minecraft-assets gives them an unrelated stand-in texture
// (the shield is dark oak planks), so they get a hand-made icon or none.
// The shield is the front face cropped from entity/shield/shield_base_nopattern.png (12×22 at 1,1).
const OVERRIDES = {
  shield:
    'data:image/png;base64,' +
    fs.readFileSync(path.join(__dirname, '../icons/shield.png')).toString('base64'),
}

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

// Item icons.
module.exports = () => {
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
