// Mob models for the watcher. The geometry is prismarine-viewer's entities.json (MIT, Bedrock-style
// bones and cubes); the textures come from this version's assets, where many have moved since.
const fs = require('node:fs')
const path = require('node:path')
const { VERSION, dataDir, assetsRoot, writeJson, pngDataUrl } = require('./common')
const { VARIANTS, HORSE_MARKINGS, VILLAGER_TYPES, PROFESSIONS } = require('./mobVariants')

const entityDir = path.join(dataDir, 'entity')

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
// Mobs drawn with another of their geometries; the sheep's default one is its wool coat.
const GEOMETRY = { sheep: 'sheared' }

const listTextures = () => {
  const all = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.png')) all.push(path.relative(entityDir, full).replace(/\.png$/, ''))
    }
  }
  walk(entityDir)
  return all
}

// Older asset versions, newest first. Mobs redesigned since the geometry was made (cows, chickens in
// 1.21.5) need the texture from before the change, since a new texture layout won't fit the old model.
const olderVersions = () =>
  fs
    .readdirSync(assetsRoot)
    .filter((name) => /^\d/.test(name) && name !== VERSION)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

// "textures/entity/cow/red_mooshroom" → a path to the texture: the same path in this or an older
// version, otherwise the closest name now (e.g. cow/mooshroom_red): a name that extends it, or one
// with the same words in another order.
const makeFindTexture = () => {
  const allTextures = listTextures()
  const versions = olderVersions()
  return (ref) => {
    const wanted = ref.replace(/^textures\/entity\//, '')
    if (allTextures.includes(wanted)) return path.join(entityDir, `${wanted}.png`)
    for (const version of versions) {
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
}

// Texture table with sizes, since mob UVs are in texture pixels.
const makeTextures = () => {
  const list = []
  const ids = new Map()
  const add = (file) => {
    if (!file || !fs.existsSync(file)) return null
    if (ids.has(file)) return ids.get(file)
    const png = fs.readFileSync(file)
    list.push({ src: pngDataUrl(png), width: png.readUInt32BE(16), height: png.readUInt32BE(20) })
    ids.set(file, list.length - 1)
    return list.length - 1
  }
  // A { name: path } table → { name: texture index }, leaving out missing files.
  const addAll = (table, toFile) =>
    Object.fromEntries(
      Object.entries(table)
        .map(([name, ref]) => [name, add(toFile(ref))])
        .filter(([, id]) => id !== null)
    )
  return { list, add, addAll }
}

const fromAssets = (ref) => path.join(assetsRoot, `${ref}.png`)

// Shifts every cube's UVs, for geometry drawn from part of a bigger Bedrock texture.
const shiftUv = (bones, du, dv) =>
  bones.map((bone) => ({
    ...bone,
    ...(bone.cubes
      ? { cubes: bone.cubes.map((cube) => ({ ...cube, uv: [cube.uv[0] + du, cube.uv[1] + dv] })) }
      : {}),
  }))

// Armor textures by material (iron, gold, leather, leather_overlay, …), from the 64×32 humanoid layers.
const armorTextures = (textures) => {
  const layers = {}
  for (const layer of ['humanoid', 'humanoid_leggings']) {
    const dir = path.join(entityDir, 'equipment', layer)
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith('.png')) : []
    layers[layer] = Object.fromEntries(
      files.map((file) => [file.replace(/\.png$/, ''), textures.add(path.join(dir, file))])
    )
  }
  return layers
}

module.exports = () => {
  const entities = require('../vendor/prismarine-viewer-entities.json')
  const findTexture = makeFindTexture()
  const textures = makeTextures()
  const out = {}
  const missing = []
  const sources = {}
  for (const [type, entity] of Object.entries(entities)) {
    const geometry = entity.geometry?.[GEOMETRY[type] ?? 'default']
    // Mobs with color variants (horses, cats, …) have no "default" texture; any variant will do.
    const refs = [entity.textures?.default, ...Object.values(entity.textures ?? {})].filter(Boolean)
    const file = [TEXTURE_OVERRIDES[type], ...refs].filter(Boolean).map(findTexture).find(Boolean)
    if (!geometry?.bones || !file) {
      missing.push(type)
      continue
    }
    sources[type] = path.relative(assetsRoot, file)
    out[type] = { texture: textures.add(file), bones: geometry.bones }
    if (VARIANTS[type]) {
      out[type].variants = textures.addAll(VARIANTS[type], fromAssets)
    }
  }

  // The sheep's wool coat: Bedrock keeps it in the bottom half of one 64×64 texture, Java in its own
  // 64×32 one (gray, dyed by the renderer).
  const wool = textures.add(path.join(entityDir, 'sheep', 'sheep_wool.png'))
  if (out.sheep && wool !== null) {
    out.sheep.coat = { texture: wool, bones: shiftUv(entities.sheep.geometry.default.bones, 0, -32) }
  }

  const layers = {}
  for (const type of ['villager', 'zombie_villager']) {
    const layer = (folder, name) => textures.add(path.join(entityDir, type, folder, `${name}.png`))
    layers[type] = {
      types: VILLAGER_TYPES.map((name) => layer('type', name)),
      professions: PROFESSIONS.map((name) => layer('profession', name)),
    }
  }
  const horseMarkings = textures.addAll(HORSE_MARKINGS, fromAssets)
  const armor = armorTextures(textures)

  // SHOW_SOURCES=1 lists which texture file each mob ended up with.
  if (process.env.SHOW_SOURCES) console.log(sources)
  writeJson(
    'entityModels.json',
    { version: VERSION, textures: textures.list, entities: out, layers, horseMarkings, armor },
    `${Object.keys(out).length} mobs${missing.length ? ` (no model or texture: ${missing.join(', ')})` : ''}`
  )
}
