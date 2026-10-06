import type { Bot } from 'mineflayer'
import prismarineBlock from 'prismarine-block'
import type { Item } from 'prismarine-item'
import type { Registry } from 'prismarine-registry'
import { Vec3 } from 'vec3'
import fullCubes from '../../../generated/fullCubes.json'
import type { InventoryItem, WorldView } from '../../../shared/types'
import { isPlaceable } from '../actions/building'
import { chatFor } from '../chatLoader'
import { registryOrder } from '../entities/entityEvents'
import {
  computeBlocks,
  VOXEL_ABOVE,
  VOXEL_BELOW,
  VOXEL_RADIUS,
  type BlocksData,
  type ComputeInput,
} from './worldCompute'
import { HOTBAR_START } from '../../../shared/inventory'
import { isTrue } from '../../../shared/blocks'

export { spreadLight } from './worldCompute'

// Blocks that are one solid 16³ cube in every state (generated from the block models).
const FULL_CUBES = new Set<string>(fullCubes)

// The slice is re-read around the bot once it moves this far from where it was last centered.
const RECENTER_DISTANCE = 14
const EMPTY_BLOCKS = new Set(['air', 'cave_air', 'void_air', 'light'])

const WATER_PLANTS = new Set(['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column'])
type Properties = Record<string, string | number | boolean>
type Description = NonNullable<InventoryItem>

const isSubmerged = (name: string, properties: Properties | undefined) =>
  WATER_PLANTS.has(name) || isTrue(properties?.waterlogged)
const isWaterBlock = (name: string, properties: Properties | undefined) =>
  name === 'water' || isSubmerged(name, properties)

// Window titles are chat components: JSON text on older servers, NBT on 1.20.3+. Sent as plain text.
const chatLoaders = new WeakMap<Registry, ReturnType<typeof chatFor>>()
const windowTitle = (bot: Bot, title: unknown) => {
  if (title == null) return ''
  try {
    let ChatMessage = chatLoaders.get(bot.registry)
    if (!ChatMessage) {
      ChatMessage = chatFor(bot.registry)
      chatLoaders.set(bot.registry, ChatMessage)
    }
    return ChatMessage.fromNotch(title as string).toString()
  } catch {
    return typeof title === 'string' ? title : ''
  }
}

const ARMOR_SLOTS = { 5: 'head', 6: 'torso', 7: 'legs', 8: 'feet' } as const
const OFFHAND_SLOT = 45

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

// 1.20.5+ keeps enchantments in item components as registry ids (in the order the server sent the
// registry); older versions in NBT, which prismarine-item reads.
// Item components (1.20.5+) aren't in prismarine-item's typings.
type ComponentItem = Item & {
  componentMap?: Map<string, { data?: unknown }>
  enchants?: { name: string; lvl?: number }[]
}

const enchantmentsOf = (bot: Bot, item: ComponentItem) => {
  let list: { name: unknown; level: number }[] | null = null
  for (const key of ['enchantments', 'stored_enchantments']) {
    const data = item.componentMap?.get?.(key)?.data
    const entries = Array.isArray(data)
      ? data
      : (data as { enchantments?: unknown } | undefined)?.enchantments
    if (Array.isArray(entries) && entries.length) {
      const order = registryOrder(bot, 'enchantment')
      list = (entries as { name?: string; id: number; level?: number; lvl?: number }[]).map((entry) => {
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

const durabilityOf = (item: ComponentItem) => {
  const max = (item.componentMap?.get?.('max_damage')?.data as number | undefined) ?? item.maxDurability
  if (!max) return null
  let used = 0
  try {
    used = item.durabilityUsed ?? 0
  } catch {
    // Version without a known durability spot.
  }
  return { used: Math.max(0, Math.min(max, used)), max }
}

export const describeItem = (bot: Bot, item: Item | null | undefined): InventoryItem => {
  if (!item) return null
  const result: Description = {
    name: item.name,
    displayName: item.displayName ?? item.name,
    count: item.count,
  }
  const durability = durabilityOf(item)
  if (durability) result.durability = durability
  const enchantments = enchantmentsOf(bot, item)
  if (enchantments.length) result.enchantments = enchantments
  if (isPlaceable(bot, item)) result.placeable = true
  return result
}

export const getInventory = (bot: Bot): WorldView['inventory'] => {
  const toItem = (item: Item | null | undefined) => describeItem(bot, item)
  const slots = bot.inventory?.slots ?? []
  const armor = {} as WorldView['inventory']['armor']
  for (const [slot, key] of Object.entries(ARMOR_SLOTS)) {
    armor[key] = toItem(slots[Number(slot)])
  }
  return {
    // Slots 9-35 are the main inventory and 36-44 the hotbar, same as the in-game layout.
    crafting: slots.slice(1, 5).map(toItem),
    craftingResult: toItem(slots[0]),
    cursor: toItem((bot.currentWindow ?? bot.inventory)?.selectedItem),
    window: bot.currentWindow
      ? {
          id: bot.currentWindow.id,
          type: String(bot.currentWindow.type),
          title: windowTitle(bot, bot.currentWindow.title),
          slots: bot.currentWindow.slots.map(toItem),
          inventoryStart: bot.currentWindow.inventoryStart,
          resultSlot: bot.currentWindow.craftingResultSlot,
        }
      : null,
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
const LIT_LIGHT: Record<string, number> = {
  furnace: 13,
  blast_furnace: 13,
  smoker: 13,
  redstone_ore: 9,
  deepslate_redstone_ore: 9,
  campfire: 15,
  soul_campfire: 10,
}
const emittedLight = (block: { name: string; emitLight?: number }, properties: Properties) => {
  if (properties.lit === false || properties.lit === 'false') return 0
  if (block.name.endsWith('candle') && properties.candles !== undefined) return 3 * Number(properties.candles)
  return LIT_LIGHT[block.name] ?? block.emitLight ?? 0
}

// Name, properties and opacity per block state, looked up once per registry.
type StateInfo = {
  name: string
  properties: Properties
  occludes: boolean
  emitLight: number
  filterLight: number
} | null
type StateCache = { Block: ReturnType<typeof prismarineBlock>; states: Map<number, StateInfo> }

const stateCaches = new WeakMap<Registry, StateCache>()
const stateInfo = (registry: Registry, stateId: number) => {
  let cache = stateCaches.get(registry)
  if (!cache) {
    cache = { Block: prismarineBlock(registry), states: new Map() } as StateCache
    stateCaches.set(registry, cache)
  }
  let info = cache.states.get(stateId)
  if (info === undefined) {
    const block = registry.blocksByStateId[stateId]
    if (!block || EMPTY_BLOCKS.has(block.name)) {
      info = null
    } else {
      let properties: Properties = {}
      try {
        properties = cache.Block.fromStateId(stateId, 0).getProperties() as Properties
      } catch {
        // Unknown state layout; the default model is used.
      }
      // Only solid, non-see-through full cubes hide the faces next to them.
      info = {
        name: block.name,
        properties,
        occludes: FULL_CUBES.has(block.name) && !block.transparent,
        emitLight: emittedLight(block, properties),
        filterLight: (block as { filterLight?: number }).filterLight ?? (block.transparent ? 0 : 15),
      }
    }
    cache.states.set(stateId, info)
  }
  return info
}

// Sky light at a spot, or null when the server hasn't sent light data.
const skyLightAt = (bot: Bot, position: Vec3) => {
  try {
    const light = (bot.world as unknown as { getSkyLight?: (position: Vec3) => unknown }).getSkyLight?.(
      position
    )
    return typeof light === 'number' ? light : null
  } catch {
    return null
  }
}

// The scanned box around the bot, kept between updates so a changed block only re-reads that cell.
// `radius`: blocks out from the bot on each side (the render distance, set from the app's settings).
export type Slice = ReturnType<typeof createSlice>

// Column access straight on the world, which mineflayer's world typings leave out.
type Column = { getBlockStateId(position: Vec3): number }
const columnAt = (bot: Bot, chunkX: number, chunkZ: number) =>
  (bot.world as unknown as { getColumn(x: number, z: number): Column | null }).getColumn(chunkX, chunkZ)

const createSlice = (origin: Vec3, radius: number) => {
  const width = radius * 2 + 1
  const height = VOXEL_BELOW + VOXEL_ABOVE + 1
  const total = width * width * height
  return {
    origin,
    radius,
    width,
    height,
    // One palette entry per block state, so the renderer can pick the right model (facing, axis, …).
    palette: [] as string[],
    properties: [] as Properties[],
    // Light given off and light blocked, per palette entry.
    emits: [] as number[],
    filters: [] as number[],
    paletteIndex: new Map<number, number>(),
    // -1 = nothing drawn there; otherwise a palette index.
    grid: new Int16Array(total).fill(-1),
    // Block type per cell; faces between two blocks of the same type (water, glass, leaves) are hidden.
    kinds: new Int16Array(total).fill(-1),
    kindIds: new Map<string, number>(),
    // Leaves keep the faces between each other, like the game's fancy leaves, so a canopy looks full.
    leafy: new Uint8Array(total),
    // Submerged plants and waterlogged blocks need to be drawn even when fully surrounded by water.
    submerged: new Uint8Array(total),
    occludes: new Uint8Array(total),
  }
}

const setCell = (slice: Slice, registry: Registry, cell: number, stateId: number) => {
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
const scanSlice = (bot: Bot, origin: Vec3, radius: number) => {
  const slice = createSlice(origin, radius)
  const { width, height } = slice
  const local = new Vec3(0, 0, 0)
  for (let z = 0; z < width; z++) {
    const worldZ = origin.z + z - radius
    for (let x = 0; x < width; x++) {
      const worldX = origin.x + x - radius
      const chunk = columnAt(bot, worldX >> 4, worldZ >> 4)
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
const patchSlice = (bot: Bot, slice: Slice, changes: Iterable<string>) => {
  const { origin, radius, width, height } = slice
  const local = new Vec3(0, 0, 0)
  for (const key of changes) {
    const [worldX, worldY, worldZ] = key.split(',').map(Number)
    const x = worldX - origin.x + radius
    const y = worldY - origin.y + VOXEL_BELOW
    const z = worldZ - origin.z + radius
    if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= width) continue
    const chunk = columnAt(bot, worldX >> 4, worldZ >> 4)
    local.set(worldX & 15, worldY, worldZ & 15)
    setCell(slice, bot.registry, (y * width + z) * width + x, chunk ? chunk.getBlockStateId(local) : 0)
  }
}

// Re-reads whole chunk columns ("cx,cz") that loaded or unloaded, where they overlap the slice.
const patchChunks = (bot: Bot, slice: Slice, chunks: Iterable<string>) => {
  const { origin, radius, width, height } = slice
  const local = new Vec3(0, 0, 0)
  for (const key of chunks) {
    const [chunkX, chunkZ] = key.split(',').map(Number)
    const chunk = columnAt(bot, chunkX, chunkZ)
    const x0 = Math.max(0, chunkX * 16 - origin.x + radius)
    const x1 = Math.min(width - 1, chunkX * 16 + 15 - origin.x + radius)
    const z0 = Math.max(0, chunkZ * 16 - origin.z + radius)
    const z1 = Math.min(width - 1, chunkZ * 16 + 15 - origin.z + radius)
    for (let z = z0; z <= z1; z++) {
      const worldZ = origin.z + z - radius
      for (let x = x0; x <= x1; x++) {
        const worldX = origin.x + x - radius
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
const shiftSlice = (bot: Bot, old: Slice, origin: Vec3) => {
  const slice = createSlice(origin, old.radius)
  const { radius } = slice
  slice.palette = old.palette
  slice.properties = old.properties
  slice.emits = old.emits
  slice.filters = old.filters
  slice.paletteIndex = old.paletteIndex
  slice.kindIds = old.kindIds
  const { width, height } = slice
  const dx = origin.x - old.origin.x
  const dy = origin.y - old.origin.y
  const dz = origin.z - old.origin.z
  const local = new Vec3(0, 0, 0)
  for (let z = 0; z < width; z++) {
    const worldZ = origin.z + z - radius
    const oldZ = z + dz
    for (let x = 0; x < width; x++) {
      const worldX = origin.x + x - radius
      const oldX = x + dx
      const columnKept = oldX >= 0 && oldX < width && oldZ >= 0 && oldZ < width
      const chunk = columnAt(bot, worldX >> 4, worldZ >> 4)
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

// What the 3D view keeps between updates, per connection: the scanned slice, the last payload built from it,
// and what changed since (the bot manager fills these in from world events).
export type WorldTracker = {
  // "x,y,z" of blocks that changed.
  changes: Set<string>
  // "cx,cz" of chunk columns that loaded or unloaded.
  chunks: Set<string>
  // Something changed since the last read.
  dirty: boolean
  // Read everything again (respawn, another dimension).
  fullDirty: boolean
  // Blocks out from the bot the view covers (the render distance); the default when unset.
  radius?: number
  cached: { origin: { x: number; y: number; z: number }; slice: Slice; data: BlocksData | null } | null
}

export const createWorldTracker = (radius?: number): WorldTracker => ({
  changes: new Set(),
  chunks: new Set(),
  dirty: false,
  fullDirty: false,
  radius,
  cached: null,
})

// Brings the kept slice up to date, reading as little of the world as it can; null when nothing changed.
export const readSlice = (bot: Bot, tracker: WorldTracker): Slice | null => {
  const botPos = bot.entity.position.floored()
  const cached = tracker.cached
  const near =
    cached &&
    (botPos.x - cached.origin.x) ** 2 + (botPos.z - cached.origin.z) ** 2 <
      RECENTER_DISTANCE * RECENTER_DISTANCE &&
    Math.abs(botPos.y - cached.origin.y) < 6
  if (near && !tracker.dirty) return null

  // A changed render distance reads the whole (resized) box again.
  const radius = tracker.radius ?? VOXEL_RADIUS
  let slice: Slice
  if (!cached?.slice || tracker.fullDirty || cached.slice.radius !== radius) {
    slice = scanSlice(bot, botPos, radius)
  } else {
    slice = near ? cached.slice : shiftSlice(bot, cached.slice, botPos)
    patchChunks(bot, slice, tracker.chunks)
    patchSlice(bot, slice, tracker.changes)
  }
  tracker.changes.clear()
  tracker.chunks.clear()
  tracker.fullDirty = false
  tracker.dirty = false
  tracker.cached = {
    origin: { x: slice.origin.x, y: slice.origin.y, z: slice.origin.z },
    slice,
    data: cached?.data ?? null,
  }
  return slice
}

// What the compute half (src/main/bot/world/worldCompute.ts) needs, copied so a worker can take it while the slice
// keeps changing.
export const computeInput = (bot: Bot, slice: Slice): ComputeInput => ({
  origin: { x: slice.origin.x, y: slice.origin.y, z: slice.origin.z },
  radius: slice.radius,
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
export const setBlocksData = (tracker: WorldTracker, data: BlocksData) => {
  if (tracker.cached) tracker.cached.data = data
}

// The blocks payload, computed right here (on this thread). The bot manager uses a worker instead.
const getBlocks = (bot: Bot, tracker: WorldTracker): BlocksData | null => {
  const slice = readSlice(bot, tracker)
  if (!slice) return tracker.cached?.data ?? null

  const data = computeBlocks(computeInput(bot, slice))
  setBlocksData(tracker, data)
  return data
}

// `cachedBlocks`: don't compute here, use the last payload (the bot manager's worker keeps it current).
export const getWorldView = (
  bot: Bot | null,
  tracker: WorldTracker,
  { cachedBlocks = false } = {}
): WorldView | null => {
  if (!bot?.entity || !bot.world) {
    return null
  }
  return {
    inventory: getInventory(bot),
    blocks: cachedBlocks ? (tracker.cached?.data ?? null) : getBlocks(bot, tracker),
  }
}
