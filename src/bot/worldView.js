const { Vec3 } = require('vec3')

// Blocks around the bot for the 3D view: only blocks that touch air (or water, glass, …) are
// sent, buried ones are skipped since they can't be seen anyway.
const VOXEL_RADIUS = 12
const VOXEL_BELOW = 8
const VOXEL_ABOVE = 6
const EMPTY_BLOCKS = new Set(['air', 'cave_air', 'void_air', 'light'])
const LIQUIDS = new Set(['water', 'lava'])
const NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]
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

const getBlocks = (bot) => {
  const origin = bot.entity.position.floored()
  const width = VOXEL_RADIUS * 2 + 1
  const height = VOXEL_BELOW + VOXEL_ABOVE + 1
  const total = width * width * height
  const palette = []
  const paletteIndex = new Map()
  // -1 = nothing drawn there; otherwise a palette index.
  const grid = new Int16Array(total).fill(-1)
  const occludes = new Uint8Array(total)
  const cursor = new Vec3(0, 0, 0)
  const indexOf = (x, y, z) => (y * width + z) * width + x

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < width; z++) {
      for (let x = 0; x < width; x++) {
        cursor.set(origin.x + x - VOXEL_RADIUS, origin.y + y - VOXEL_BELOW, origin.z + z - VOXEL_RADIUS)
        const block = bot.registry.blocksByStateId[bot.world.getBlockStateId(cursor)]
        if (!block || EMPTY_BLOCKS.has(block.name)) {
          continue
        }
        const solid = block.boundingBox === 'block'
        if (!solid && !LIQUIDS.has(block.name)) {
          continue
        }
        let index = paletteIndex.get(block.name)
        if (index === undefined) {
          index = palette.length
          palette.push(block.name)
          paletteIndex.set(block.name, index)
        }
        const cell = indexOf(x, y, z)
        grid[cell] = index
        occludes[cell] = solid && !block.transparent ? 1 : 0
      }
    }
  }

  const positions = []
  const blocks = []
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < width; z++) {
      for (let x = 0; x < width; x++) {
        const cell = indexOf(x, y, z)
        const index = grid[cell]
        if (index < 0) {
          continue
        }
        const exposed = NEIGHBORS.some(([nx, ny, nz]) => {
          const ax = x + nx
          const ay = y + ny
          const az = z + nz
          // The edges of the box count as covered, so caves show through the sides.
          if (ax < 0 || ay < 0 || az < 0 || ax >= width || ay >= height || az >= width) {
            return false
          }
          const neighbor = indexOf(ax, ay, az)
          return !occludes[neighbor] && grid[neighbor] !== index
        })
        if (exposed) {
          positions.push(x - VOXEL_RADIUS, y - VOXEL_BELOW, z - VOXEL_RADIUS)
          blocks.push(index)
        }
      }
    }
  }

  let hash = hashNumbers(2166136261, [origin.x, origin.y, origin.z])
  hash = hashNumbers(hash, positions)
  hash = hashNumbers(hash, blocks)

  return {
    key: `${(hash >>> 0).toString(36)}:${palette.join(',')}`,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    radius: VOXEL_RADIUS,
    palette,
    positions,
    blocks,
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
    entities.push({
      id: entity.id,
      kind,
      name: entity.username ?? entity.displayName ?? entity.name ?? kind,
      x: round(entity.position.x),
      y: round(entity.position.y),
      z: round(entity.position.z),
      yaw: round(entity.yaw ?? 0),
    })
  }
  return {
    bot: { x: round(position.x), y: round(position.y), z: round(position.z), yaw: round(bot.entity.yaw) },
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
