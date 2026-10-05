const { Vec3 } = require('vec3')
const prismarineBlock = require('prismarine-block')
const loadPrismarineChat = require('prismarine-chat')
// Blocks that are one solid 16³ cube in every state (generated from the block models).
const FULL_CUBES = new Set(require('../generated/fullCubes.json'))
const { computeBlocks, spreadLight, VOXEL_RADIUS, VOXEL_BELOW, VOXEL_ABOVE } = require('./worldCompute')

// The slice is re-read around the bot once it moves this far from where it was last centered.
const RECENTER_DISTANCE = 14
const EMPTY_BLOCKS = new Set(['air', 'cave_air', 'void_air', 'light'])
const { registryOrder } = require('./entityEvents')
const { isPlaceable } = require('./building')

const WATER_PLANTS = new Set(['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column'])
const isSubmerged = (name, properties) =>
  WATER_PLANTS.has(name) || properties?.waterlogged === true || properties?.waterlogged === 'true'
const isWaterBlock = (name, properties) =>
  name === 'water' || isSubmerged(name, properties)

// Window titles are chat components: JSON text on older servers, NBT on 1.20.3+. Sent as plain text.
const chatLoaders = new WeakMap()
const windowTitle = (bot, title) => {
  if (title == null) return ''
  try {
    let ChatMessage = chatLoaders.get(bot.registry)
    if (!ChatMessage) {
      ChatMessage = loadPrismarineChat(bot.registry)
      chatLoaders.set(bot.registry, ChatMessage)
    }
    return ChatMessage.fromNotch(title).toString()
  } catch {
    return typeof title === 'string' ? title : ''
  }
}

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
      title: windowTitle(bot, bot.currentWindow.title),
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
// Light by state for blocks that only glow when lit; the block data gives one value for every state.
const LIT_LIGHT = { furnace: 13, blast_furnace: 13, smoker: 13, redstone_ore: 9, deepslate_redstone_ore: 9, campfire: 15, soul_campfire: 10 }
const emittedLight = (block, properties) => {
  if (properties.lit === false || properties.lit === 'false') return 0
  if (block.name.endsWith('candle') && properties.candles !== undefined) return 3 * Number(properties.candles)
  return LIT_LIGHT[block.name] ?? block.emitLight ?? 0
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
      info = {
        name: block.name,
        properties,
        occludes: FULL_CUBES.has(block.name) && !block.transparent,
        emitLight: emittedLight(block, properties),
        filterLight: block.filterLight ?? (block.transparent ? 0 : 15),
      }
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

// The scanned box around the bot, kept between updates so a changed block only re-reads that cell.
const createSlice = (origin) => {
  const width = VOXEL_RADIUS * 2 + 1
  const height = VOXEL_BELOW + VOXEL_ABOVE + 1
  const total = width * width * height
  return {
    origin,
    width,
    height,
    // One palette entry per block state, so the renderer can pick the right model (facing, axis, …).
    palette: [],
    properties: [],
    // Light given off and light blocked, per palette entry.
    emits: [],
    filters: [],
    paletteIndex: new Map(),
    // -1 = nothing drawn there; otherwise a palette index.
    grid: new Int16Array(total).fill(-1),
    // Block type per cell; faces between two blocks of the same type (water, glass, leaves) are hidden.
    kinds: new Int16Array(total).fill(-1),
    kindIds: new Map(),
    // Leaves keep the faces between each other, like the game's fancy leaves, so a canopy looks full.
    leafy: new Uint8Array(total),
    // Submerged plants and waterlogged blocks need to be drawn even when fully surrounded by water.
    submerged: new Uint8Array(total),
    occludes: new Uint8Array(total),
  }
}

const setCell = (slice, registry, cell, stateId) => {
  const info = stateInfo(registry, stateId)
  if (!info) {
    slice.grid[cell] = -1
    slice.kinds[cell] = -1
    slice.leafy[cell] = 0
    slice.occludes[cell] = 0
    slice.submerged[cell] = 0
    return
  }
  let index = slice.paletteIndex.get(stateId)
  if (index === undefined) {
    index = slice.palette.length
    slice.palette.push(info.name)
    slice.properties.push(info.properties)
    slice.emits.push(info.emitLight)
    slice.filters.push(info.filterLight)
    slice.paletteIndex.set(stateId, index)
  }
  const kindKey = isWaterBlock(info.name, info.properties) ? 'water' : info.name
  let kind = slice.kindIds.get(kindKey)
  if (kind === undefined) {
    kind = slice.kindIds.size
    slice.kindIds.set(kindKey, kind)
  }
  slice.grid[cell] = index
  slice.kinds[cell] = kind
  slice.leafy[cell] = info.name.endsWith('_leaves') ? 1 : 0
  slice.occludes[cell] = info.occludes ? 1 : 0
  slice.submerged[cell] = isSubmerged(info.name, info.properties) ? 1 : 0
}

// Reads every cell, straight from the chunk columns (the world's own lookup allocates per call).
const scanSlice = (bot, origin) => {
  const slice = createSlice(origin)
  const { width, height } = slice
  const local = new Vec3(0, 0, 0)
  for (let z = 0; z < width; z++) {
    const worldZ = origin.z + z - VOXEL_RADIUS
    for (let x = 0; x < width; x++) {
      const worldX = origin.x + x - VOXEL_RADIUS
      const chunk = bot.world.getColumn(worldX >> 4, worldZ >> 4)
      if (!chunk) continue
      for (let y = 0; y < height; y++) {
        local.set(worldX & 15, origin.y + y - VOXEL_BELOW, worldZ & 15)
        setCell(slice, bot.registry, (y * width + z) * width + x, chunk.getBlockStateId(local))
      }
    }
  }
  return slice
}

// Re-reads only the cells that changed (block updates), when nothing else did.
const patchSlice = (bot, slice, changes) => {
  const { origin, width, height } = slice
  const local = new Vec3(0, 0, 0)
  for (const key of changes) {
    const [worldX, worldY, worldZ] = key.split(',').map(Number)
    const x = worldX - origin.x + VOXEL_RADIUS
    const y = worldY - origin.y + VOXEL_BELOW
    const z = worldZ - origin.z + VOXEL_RADIUS
    if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= width) continue
    const chunk = bot.world.getColumn(worldX >> 4, worldZ >> 4)
    local.set(worldX & 15, worldY, worldZ & 15)
    setCell(slice, bot.registry, (y * width + z) * width + x, chunk ? chunk.getBlockStateId(local) : 0)
  }
}

// Re-reads whole chunk columns ("cx,cz") that loaded or unloaded, where they overlap the slice.
const patchChunks = (bot, slice, chunks) => {
  const { origin, width, height } = slice
  const local = new Vec3(0, 0, 0)
  for (const key of chunks) {
    const [chunkX, chunkZ] = key.split(',').map(Number)
    const chunk = bot.world.getColumn(chunkX, chunkZ)
    const x0 = Math.max(0, chunkX * 16 - origin.x + VOXEL_RADIUS)
    const x1 = Math.min(width - 1, chunkX * 16 + 15 - origin.x + VOXEL_RADIUS)
    const z0 = Math.max(0, chunkZ * 16 - origin.z + VOXEL_RADIUS)
    const z1 = Math.min(width - 1, chunkZ * 16 + 15 - origin.z + VOXEL_RADIUS)
    for (let z = z0; z <= z1; z++) {
      const worldZ = origin.z + z - VOXEL_RADIUS
      for (let x = x0; x <= x1; x++) {
        const worldX = origin.x + x - VOXEL_RADIUS
        for (let y = 0; y < height; y++) {
          local.set(worldX & 15, origin.y + y - VOXEL_BELOW, worldZ & 15)
          setCell(slice, bot.registry, (y * width + z) * width + x, chunk ? chunk.getBlockStateId(local) : 0)
        }
      }
    }
  }
}

// The bot moved far enough to re-center: cells both boxes share are copied over, and only the new strip
// is read from the world. The palette carries over, so copied palette indices stay right.
const shiftSlice = (bot, old, origin) => {
  const slice = createSlice(origin)
  for (const key of ['palette', 'properties', 'emits', 'filters', 'paletteIndex', 'kindIds']) slice[key] = old[key]
  const { width, height } = slice
  const dx = origin.x - old.origin.x
  const dy = origin.y - old.origin.y
  const dz = origin.z - old.origin.z
  const local = new Vec3(0, 0, 0)
  for (let z = 0; z < width; z++) {
    const worldZ = origin.z + z - VOXEL_RADIUS
    const oldZ = z + dz
    for (let x = 0; x < width; x++) {
      const worldX = origin.x + x - VOXEL_RADIUS
      const oldX = x + dx
      const columnKept = oldX >= 0 && oldX < width && oldZ >= 0 && oldZ < width
      const chunk = bot.world.getColumn(worldX >> 4, worldZ >> 4)
      for (let y = 0; y < height; y++) {
        const cell = (y * width + z) * width + x
        const oldY = y + dy
        if (columnKept && oldY >= 0 && oldY < height) {
          const from = (oldY * width + oldZ) * width + oldX
          slice.grid[cell] = old.grid[from]
          slice.kinds[cell] = old.kinds[from]
          slice.leafy[cell] = old.leafy[from]
          slice.submerged[cell] = old.submerged[from]
          slice.occludes[cell] = old.occludes[from]
        } else if (chunk) {
          local.set(worldX & 15, origin.y + y - VOXEL_BELOW, worldZ & 15)
          setCell(slice, bot.registry, cell, chunk.getBlockStateId(local))
        }
      }
    }
  }
  return slice
}

// Brings the kept slice up to date, reading as little of the world as it can; null when nothing changed.
// Dirty state the bot manager keeps: `_worldChanges` holds "x,y,z" of updated blocks, `_worldChunks`
// "cx,cz" of chunk columns that loaded or unloaded, and `_worldFullDirty` asks for a fresh read
// (respawn, another dimension).
const readSlice = (bot) => {
  const botPos = bot.entity.position.floored()
  const cached = bot._worldSlice
  const near =
    cached &&
    (botPos.x - cached.origin.x) ** 2 + (botPos.z - cached.origin.z) ** 2 < RECENTER_DISTANCE * RECENTER_DISTANCE &&
    Math.abs(botPos.y - cached.origin.y) < 6
  if (near && !bot._worldDirty) return null

  let slice
  if (!cached?.slice || bot._worldFullDirty) {
    slice = scanSlice(bot, botPos)
  } else {
    slice = near ? cached.slice : shiftSlice(bot, cached.slice, botPos)
    patchChunks(bot, slice, bot._worldChunks ?? [])
    patchSlice(bot, slice, bot._worldChanges ?? [])
  }
  bot._worldChanges?.clear?.()
  bot._worldChunks?.clear?.()
  bot._worldFullDirty = false
  bot._worldDirty = false
  bot._worldSlice = { origin: { x: slice.origin.x, y: slice.origin.y, z: slice.origin.z }, slice, data: cached?.data ?? null }
  return slice
}

// What the compute half (src/bot/worldCompute.js) needs, copied so a worker can take it while the slice
// keeps changing.
const computeInput = (bot, slice) => ({
  origin: { x: slice.origin.x, y: slice.origin.y, z: slice.origin.z },
  width: slice.width,
  height: slice.height,
  palette: [...slice.palette],
  properties: [...slice.properties],
  emits: [...slice.emits],
  filters: [...slice.filters],
  grid: slice.grid.slice(),
  kinds: slice.kinds.slice(),
  leafy: slice.leafy.slice(),
  submerged: slice.submerged.slice(),
  occludes: slice.occludes.slice(),
  skyLight: skyLightAt(bot, slice.origin.offset(0, 1, 0)),
})

// Keeps the payload the watcher last got, for getWorldView.
const setBlocksData = (bot, data) => {
  if (bot._worldSlice) bot._worldSlice.data = data
}

// The blocks payload, computed right here (on this thread). The bot manager uses a worker instead.
const getBlocks = (bot) => {
  const slice = readSlice(bot)
  if (!slice) return bot._worldSlice?.data ?? null

  const data = computeBlocks(computeInput(bot, slice))
  setBlocksData(bot, data)
  return data
}

// `cachedBlocks`: don't compute here, use the last payload (the bot manager's worker keeps it current).
const getWorldView = (bot, { cachedBlocks = false } = {}) => {
  if (!bot?.entity || !bot.world) {
    return null
  }
  return {
    inventory: getInventory(bot),
    blocks: cachedBlocks ? (bot._worldSlice?.data ?? null) : getBlocks(bot),
  }
}

module.exports = { getWorldView, getInventory, describeItem, spreadLight, readSlice, computeInput, setBlocksData }
