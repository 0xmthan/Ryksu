const { Vec3 } = require('vec3')
const prismarineBlock = require('prismarine-block')
// Blocks that are one solid 16³ cube in every state (generated from the block models).
const FULL_CUBES = new Set(require('../generated/fullCubes.json'))
const { analyzeView } = require('./viewModes')
const { registryOrder } = require('./entityEvents')
const { isPlaceable } = require('./building')

// Blocks around the bot for the 3D view: only blocks with a face touching air (or water, glass, …)
// are sent, each with a mask of those faces, so buried blocks and hidden faces are never drawn.
const VOXEL_RADIUS = 52
const VOXEL_BELOW = 18
const VOXEL_ABOVE = 30
const RECENTER_DISTANCE = 14
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
// The renderer can hide blocks this high above the feet and up (the roof indoors, the ceiling in caves).
// Extra mask bits tell it which: the layer just below the cut needs its top faces even where covered
// (CUT_TOP), roof hiding only applies over the bot's room (ROOM), and cave mode keeps only the blocks
// around the air the bot can reach (SHELL). See viewModes.js.
const ROOF_CUTOFF = 2
const CUT_TOP_BIT = 1 << 6
const ROOM_BIT = 1 << 7
const SHELL_BIT = 1 << 8
const WATER_PLANT_BIT = 1 << 9

const WATER_PLANTS = new Set(['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column'])
const isSubmerged = (name, properties) =>
  WATER_PLANTS.has(name) || properties?.waterlogged === true || properties?.waterlogged === 'true'
const isWaterBlock = (name, properties) =>
  name === 'water' || isSubmerged(name, properties)

const ARMOR_SLOTS = { 5: 'head', 6: 'torso', 7: 'legs', 8: 'feet' }
const OFFHAND_SLOT = 45
const HOTBAR_START = 36

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

// 1.20.5+ keeps enchantments in item components as registry ids (in the order the server sent the
// registry); older versions in NBT, which prismarine-item reads.
const enchantmentsOf = (bot, item) => {
  let list = null
  for (const key of ['enchantments', 'stored_enchantments']) {
    const data = item.componentMap?.get?.(key)?.data
    const entries = Array.isArray(data) ? data : data?.enchantments
    if (Array.isArray(entries) && entries.length) {
      const order = registryOrder(bot, 'enchantment')
      list = entries.map((entry) => {
        const name = entry.name ?? order?.[entry.id] ?? bot.registry.enchantments?.[entry.id]?.name
        return { name, level: entry.level ?? entry.lvl ?? 1 }
      })
      break
    }
  }
  if (!list) {
    try {
      list = (item.enchants ?? []).map((entry) => ({ name: entry.name, level: entry.lvl ?? 1 }))
    } catch {
      list = []
    }
  }
  return list
    .filter((entry) => entry.name)
    .map(({ name, level }) => {
      const key = String(name).replace(/^minecraft:/, '')
      const info = bot.registry.enchantmentsByName?.[key]
      const title = info?.displayName ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      // Like the game: no numeral on single-level enchantments.
      const numeral = info?.maxLevel === 1 && level === 1 ? '' : ` ${ROMAN[level] ?? level}`
      return { label: `${title}${numeral}`, ...(key.endsWith('curse') ? { curse: true } : {}) }
    })
}

const durabilityOf = (item) => {
  const max = item.componentMap?.get?.('max_damage')?.data ?? item.maxDurability
  if (!max) return null
  let used = 0
  try {
    used = item.durabilityUsed ?? 0
  } catch {
    // Version without a known durability spot.
  }
  return { used: Math.max(0, Math.min(max, used)), max }
}

const describeItem = (bot, item) => {
  if (!item) return null
  const result = { name: item.name, displayName: item.displayName ?? item.name, count: item.count }
  const durability = durabilityOf(item)
  if (durability) result.durability = durability
  const enchantments = enchantmentsOf(bot, item)
  if (enchantments.length) result.enchantments = enchantments
  if (isPlaceable(bot, item)) result.placeable = true
  return result
}

const getInventory = (bot) => {
  const toItem = (item) => describeItem(bot, item)
  const slots = bot.inventory?.slots ?? []
  const armor = {}
  for (const [slot, key] of Object.entries(ARMOR_SLOTS)) {
    armor[key] = toItem(slots[slot])
  }
  return {
    // Slots 9-35 are the main inventory and 36-44 the hotbar, same as the in-game layout.
    crafting: slots.slice(1, 5).map(toItem),
    craftingResult: toItem(slots[0]),
    cursor: toItem((bot.currentWindow ?? bot.inventory)?.selectedItem),
    window: bot.currentWindow ? {
      id: bot.currentWindow.id,
      type: bot.currentWindow.type,
      title: String(bot.currentWindow.title ?? ''),
      slots: bot.currentWindow.slots.map(toItem),
      inventoryStart: bot.currentWindow.inventoryStart,
      resultSlot: bot.currentWindow.craftingResultSlot,
    } : null,
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

// Sky light at a spot, or null when the server hasn't sent light data.
const skyLightAt = (bot, position) => {
  try {
    const light = bot.world.getSkyLight?.(position)
    return typeof light === 'number' ? light : null
  } catch {
    return null
  }
}

const getBlocks = (bot) => {
  const botPos = bot.entity.position.floored()
  const cached = bot._worldSlice

  if (cached && !bot._worldDirty) {
    const dx = botPos.x - cached.origin.x
    const dz = botPos.z - cached.origin.z
    const dy = Math.abs(botPos.y - cached.origin.y)
    if (dx * dx + dz * dz < RECENTER_DISTANCE * RECENTER_DISTANCE && dy < 6) {
      return cached.data
    }
  }

  const origin = botPos
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
  // Leaves keep the faces between each other, like the game's fancy leaves, so a canopy looks full.
  const leafy = new Uint8Array(total)
  // Submerged plants and waterlogged blocks need to be drawn even when fully surrounded by water.
  const submerged = new Uint8Array(total)
  const kindIds = new Map()
  const occludes = new Uint8Array(total)
  const cursor = new Vec3(0, 0, 0)
  const indexOf = (x, y, z) => (y * width + z) * width + x

  for (let z = 0; z < width; z++) {
    const worldZ = origin.z + z - VOXEL_RADIUS
    const chunkZ = worldZ >> 4
    for (let x = 0; x < width; x++) {
      const worldX = origin.x + x - VOXEL_RADIUS
      const chunkX = worldX >> 4
      const chunk = bot.world.getColumn(chunkX, chunkZ)
      if (!chunk) {
        continue
      }
      for (let y = 0; y < height; y++) {
        const worldY = origin.y + y - VOXEL_BELOW
        cursor.set(worldX, worldY, worldZ)
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
        const isWater = isWaterBlock(info.name, info.properties)
        const kindKey = isWater ? 'water' : info.name
        let kind = kindIds.get(kindKey)
        if (kind === undefined) {
          kind = kindIds.size
          kindIds.set(kindKey, kind)
        }
        const cell = indexOf(x, y, z)
        grid[cell] = index
        kinds[cell] = kind
        leafy[cell] = info.name.endsWith('_leaves') ? 1 : 0
        occludes[cell] = info.occludes ? 1 : 0
        submerged[cell] = isSubmerged(info.name, info.properties) ? 1 : 0
      }
    }
  }

  const roofLayer = VOXEL_BELOW + ROOF_CUTOFF - 1
  const view = analyzeView({
    grid,
    occludes,
    palette,
    width,
    height,
    feetY: VOXEL_BELOW,
    center: VOXEL_RADIUS,
    cutoffY: roofLayer + 1,
    skyLight: skyLightAt(bot, origin.offset(0, 1, 0)),
  })

  const positions = []
  const blocks = []
  const faces = []
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < width; z++) {
      for (let x = 0; x < width; x++) {
        const cell = indexOf(x, y, z)
        const index = grid[cell]
        if (index < 0) {
          continue
        }
        let mask = 0
        for (let face = 0; face < 6; face++) {
          const [nx, ny, nz] = NEIGHBORS[face]
          const ax = x + nx
          const ay = y + ny
          const az = z + nz
          // The edges of the box are drawn, so the view looks like a solid cut-out of the world.
          if (ax < 0 || ay < 0 || az < 0 || ax >= width || ay >= height || az >= width) {
            mask |= 1 << face
            continue
          }
          const neighbor = indexOf(ax, ay, az)
          if (!occludes[neighbor] && (kinds[neighbor] !== kinds[cell] || leafy[cell])) {
            mask |= 1 << face
          }
        }
        if (y === roofLayer && !(mask & 1)) {
          mask |= CUT_TOP_BIT
        }
        if (submerged[cell]) {
          mask |= WATER_PLANT_BIT
        }
        if (mask) {
          if (view.inRoom(x, z)) mask |= ROOM_BIT
          if (view.shell[cell]) mask |= SHELL_BIT
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

  const data = {
    key: `${(hash >>> 0).toString(36)}:${JSON.stringify(properties)}:${palette.join(',')}`,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    radius: VOXEL_RADIUS,
    roofCutoff: ROOF_CUTOFF,
    environment: view.environment,
    palette,
    properties,
    positions,
    blocks,
    faces,
  }

  bot._worldDirty = false
  bot._worldSlice = {
    origin: { x: origin.x, y: origin.y, z: origin.z },
    data,
  }

  return data
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

module.exports = { getWorldView, describeItem }
