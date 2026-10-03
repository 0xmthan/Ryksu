const { Vec3 } = require('vec3')
const prismarineBlock = require('prismarine-block')
// Blocks that are one solid 16³ cube in every state (generated from the block models).
const FULL_CUBES = new Set(require('../generated/fullCubes.json'))

// Blocks around the bot for the 3D view: only blocks with a face touching air (or water, glass, …)
// are sent, each with a mask of those faces, so buried blocks and hidden faces are never drawn.
const VOXEL_RADIUS = 12
const VOXEL_BELOW = 8
const VOXEL_ABOVE = 6
const EMPTY_BLOCKS = new Set(['air', 'cave_air', 'void_air', 'light'])
// Face order shared with the renderer: up, down, north (-z), south (+z), west (-x), east (+x).
const NEIGHBORS = [
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
]
// The renderer can hide blocks this high above the feet and up ("Hide roof"). The layer just below
// then needs its top faces even where they are covered, so they get an extra bit in the mask.
const ROOF_CUTOFF = 2
const ROOF_FACE_BIT = 1 << 6
const ENTITY_RANGE = 24

const ARMOR_SLOTS = { 5: 'head', 6: 'torso', 7: 'legs', 8: 'feet' }
const OFFHAND_SLOT = 45
const HOTBAR_START = 36

const toItem = (item) =>
  item ? { name: item.name, displayName: item.displayName ?? item.name, count: item.count } : null

const getInventory = (bot) => {
  const slots = bot.inventory?.slots ?? []
  const armor = {}
  for (const [slot, key] of Object.entries(ARMOR_SLOTS)) {
    armor[key] = toItem(slots[slot])
  }
  return {
    // Slots 9-35 are the main inventory and 36-44 the hotbar, same as the in-game layout.
    main: slots.slice(9, HOTBAR_START).map(toItem),
    hotbar: slots.slice(HOTBAR_START, HOTBAR_START + 9).map(toItem),
    armor,
    offhand: toItem(slots[OFFHAND_SLOT]),
    selectedHotbar: Number.isInteger(bot.quickBarSlot) ? bot.quickBarSlot : 0,
    freeSlots: bot.inventory?.emptySlotCount?.() ?? 0,
  }
}

// FNV-1a over the block data, so the renderer can skip rebuilding when nothing changed.
const hashNumbers = (hash, values) => {
  for (const value of values) {
    hash ^= value & 0xffff
    hash = Math.imul(hash, 16777619)
  }
  return hash
}

// Name, properties and opacity per block state, looked up once per registry.
const stateCaches = new WeakMap()
const stateInfo = (registry, stateId) => {
  let cache = stateCaches.get(registry)
  if (!cache) {
    cache = { Block: prismarineBlock(registry), states: new Map() }
    stateCaches.set(registry, cache)
  }
  let info = cache.states.get(stateId)
  if (info === undefined) {
    const block = registry.blocksByStateId[stateId]
    if (!block || EMPTY_BLOCKS.has(block.name)) {
      info = null
    } else {
      let properties = {}
      try {
        properties = cache.Block.fromStateId(stateId, 0).getProperties()
      } catch {
        // Unknown state layout; the default model is used.
      }
      // Only solid, non-see-through full cubes hide the faces next to them.
      info = { name: block.name, properties, occludes: FULL_CUBES.has(block.name) && !block.transparent }
    }
    cache.states.set(stateId, info)
  }
  return info
}

const getBlocks = (bot) => {
  const origin = bot.entity.position.floored()
  const width = VOXEL_RADIUS * 2 + 1
  const height = VOXEL_BELOW + VOXEL_ABOVE + 1
  const total = width * width * height
  // One palette entry per block state, so the renderer can pick the right model (facing, axis, …).
  const palette = []
  const properties = []
  const paletteIndex = new Map()
  // -1 = nothing drawn there; otherwise a palette index.
  const grid = new Int16Array(total).fill(-1)
  // Block type per cell; faces between two blocks of the same type (water, glass, leaves) are hidden.
  const kinds = new Int16Array(total).fill(-1)
  const kindIds = new Map()
  const occludes = new Uint8Array(total)
  const cursor = new Vec3(0, 0, 0)
  const indexOf = (x, y, z) => (y * width + z) * width + x

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < width; z++) {
      for (let x = 0; x < width; x++) {
        cursor.set(origin.x + x - VOXEL_RADIUS, origin.y + y - VOXEL_BELOW, origin.z + z - VOXEL_RADIUS)
        const stateId = bot.world.getBlockStateId(cursor)
        const info = stateInfo(bot.registry, stateId)
        if (!info) {
          continue
        }
        let index = paletteIndex.get(stateId)
        if (index === undefined) {
          index = palette.length
          palette.push(info.name)
          properties.push(info.properties)
          paletteIndex.set(stateId, index)
        }
        let kind = kindIds.get(info.name)
        if (kind === undefined) {
          kind = kindIds.size
          kindIds.set(info.name, kind)
        }
        const cell = indexOf(x, y, z)
        grid[cell] = index
        kinds[cell] = kind
        occludes[cell] = info.occludes ? 1 : 0
      }
    }
  }

  const positions = []
  const blocks = []
  const faces = []
  const roofLayer = VOXEL_BELOW + ROOF_CUTOFF - 1
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < width; z++) {
      for (let x = 0; x < width; x++) {
        const cell = indexOf(x, y, z)
        const index = grid[cell]
        if (index < 0) {
          continue
        }
        let mask = 0
        NEIGHBORS.forEach(([nx, ny, nz], face) => {
          const ax = x + nx
          const ay = y + ny
          const az = z + nz
          // The edges of the box are drawn, so the view looks like a solid cut-out of the world.
          if (ax < 0 || ay < 0 || az < 0 || ax >= width || ay >= height || az >= width) {
            mask |= 1 << face
            return
          }
          const neighbor = indexOf(ax, ay, az)
          if (!occludes[neighbor] && kinds[neighbor] !== kinds[cell]) {
            mask |= 1 << face
          }
        })
        if (y === roofLayer && !(mask & 1)) {
          mask |= ROOF_FACE_BIT
        }
        if (mask) {
          positions.push(x - VOXEL_RADIUS, y - VOXEL_BELOW, z - VOXEL_RADIUS)
          blocks.push(index)
          faces.push(mask)
        }
      }
    }
  }

  let hash = hashNumbers(2166136261, [origin.x, origin.y, origin.z])
  hash = hashNumbers(hash, positions)
  hash = hashNumbers(hash, blocks)
  hash = hashNumbers(hash, faces)

  return {
    key: `${(hash >>> 0).toString(36)}:${JSON.stringify(properties)}:${palette.join(',')}`,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    radius: VOXEL_RADIUS,
    roofCutoff: ROOF_CUTOFF,
    palette,
    properties,
    positions,
    blocks,
    faces,
  }
}

const entityKind = (entity) => {
  if (entity.type === 'player') return 'player'
  if (entity.name === 'item') return 'item'
  if (entity.type === 'hostile') return 'hostile'
  if (['mob', 'animal', 'passive', 'water_creature', 'ambient'].includes(entity.type)) return 'passive'
  return null
}

const round = (value) => Math.round(value * 100) / 100

// Where a mob's metadata keeps a given value (it shifts between versions), from minecraft-data.
const metadataIndex = (registry, entityName, key) => {
  const keys = registry.entitiesByName?.[entityName]?.metadataKeys
  return Array.isArray(keys) ? keys.indexOf(key) : -1
}
const metadataValue = (bot, entity, key) => {
  const index = metadataIndex(bot.registry, entity.name, key)
  return index >= 0 ? entity.metadata?.[index] : undefined
}

// Only Mojang's skin server; the URL comes from the server, so nothing else gets fetched.
const skinUrl = (player) => {
  const url = player?.skinData?.url
  return typeof url === 'string' && /^https?:\/\/textures\.minecraft\.net\//.test(url)
    ? url.replace(/^http:/, 'https:')
    : null
}

// Baby flag, villager outfit and player skin, for drawing the mob the way it looks in game.
const appearance = (bot, entity, kind) => {
  const result = {}
  if (metadataValue(bot, entity, 'baby') === true) {
    result.baby = true
  }
  const villager = metadataValue(bot, entity, 'villager_data')
  if (villager && typeof villager === 'object') {
    result.villager = { type: villager.villagerType ?? 0, profession: villager.villagerProfession ?? 0 }
  }
  if (kind === 'player') {
    const player = bot.players?.[entity.username]
    const skin = skinUrl(player)
    if (skin) result.skin = skin
    // Slim ("Alex") skins are drawn for 3-pixel-wide arms.
    if (player?.skinData?.model === 'slim') result.slim = true
  }
  return result
}

// Positions of the bot and the things around it; sent often so the 3D view can move smoothly.
const getMotion = (bot) => {
  if (!bot?.entity) {
    return null
  }
  const position = bot.entity.position
  const entities = []
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || !entity?.position || entity.position.distanceTo(position) > ENTITY_RANGE) {
      continue
    }
    const kind = entityKind(entity)
    if (!kind) {
      continue
    }
    let item = null
    if (kind === 'item') {
      try {
        item = entity.getDroppedItem?.()?.name ?? null
      } catch {
        // Metadata not in yet.
      }
    }
    entities.push({
      id: entity.id,
      kind,
      // Mob type (zombie, cow, …) for picking its model, and what a dropped item is.
      type: entity.name ?? null,
      item,
      name: entity.username ?? entity.displayName ?? entity.name ?? kind,
      x: round(entity.position.x),
      y: round(entity.position.y),
      z: round(entity.position.z),
      yaw: round(entity.yaw ?? 0),
      ...appearance(bot, entity, kind),
    })
  }
  return {
    bot: {
      x: round(position.x),
      y: round(position.y),
      z: round(position.z),
      yaw: round(bot.entity.yaw),
      skin: skinUrl(bot.player),
      slim: bot.player?.skinData?.model === 'slim',
    },
    entities,
  }
}

const getWorldView = (bot) => {
  if (!bot?.entity || !bot.world) {
    return null
  }
  return {
    inventory: getInventory(bot),
    blocks: getBlocks(bot),
  }
}

module.exports = { getWorldView, getMotion }
