// The pure half of the 3D view: from the scanned block grid around the bot (src/bot/worldView.js) to the
// payload the watcher draws: which blocks show and which of their faces, the view mode hints, and block
// light. No world access, so it runs off the main thread in a worker (src/worldWorker.js), keeping the
// bot's physics ticks on time.
import type { BlockView } from '../types'
import { analyzeView } from './viewModes'

export type BlocksData = BlockView

// What computeBlocks needs from the scanned slice (see computeInput in worldView.ts).
export type ComputeInput = {
  origin: { x: number; y: number; z: number }
  radius?: number
  width: number
  height: number
  palette: string[]
  properties: Record<string, string | number | boolean>[]
  emits: number[]
  filters: number[]
  grid: Int16Array
  kinds: Int16Array
  leafy: Uint8Array
  submerged: Uint8Array
  occludes: Uint8Array
  skyLight: number | null
}

// Blocks around the bot for the 3D view: only blocks with a face touching air (or water, glass, …)
// are sent, each with a mask of those faces, so buried blocks and hidden faces are never drawn.
// The default render distance; the app can set another (see readSlice in worldView.js). At most 127: the
// renderer packs block positions into keys that hold ±127 (blockMesher.ts).
export const VOXEL_RADIUS = 52
export const VOXEL_BELOW = 18
export const VOXEL_ABOVE = 30
// Face order shared with the renderer: up, down, north (-z), south (+z), west (-x), east (+x).
export const NEIGHBORS: [number, number, number][] = [
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
export const ROOF_CUTOFF = 2
const CUT_TOP_BIT = 1 << 6
const ROOM_BIT = 1 << 7
const SHELL_BIT = 1 << 8
const WATER_PLANT_BIT = 1 << 9
// A block with a drawn solid block on top, from CAP_DEPTH layers under the bot's feet up: sent even when
// nothing else of it shows, so its top can be drawn (darkened) while the block over it is a see-through
// hologram (see src/components/watcher/seeThrough.ts).
const CAP_BIT = 1 << 10
// The slice is only rebuilt once the bot moves 6 blocks up or down, so caps go deeper than its feet.
const CAP_DEPTH = 7

const hashNumbers = (hash: number, values: Iterable<number>) => {
  for (const value of values) {
    hash ^= value & 0xffff
    hash = Math.imul(hash, 16777619)
  }
  return hash
}

// Block light (torches, lava, glowstone, …) spread through the view the way the game does it: one level
// less per block, more through leaves and water, stopped by solid blocks. Computed here rather than read
// from the server, whose light data is often missing or stale for parts of the world. Per cell: the
// level, or OPAQUE for cells light can't enter (the renderer leaves them out when smoothing).
const OPAQUE = 255
export const spreadLight = ({
  grid,
  emits,
  filters,
  width,
  height,
}: {
  grid: ArrayLike<number>
  emits: ArrayLike<number>
  filters: ArrayLike<number>
  width: number
  height: number
}) => {
  const total = grid.length
  const cells = new Uint8Array(total)
  const queue: number[] = []
  for (let cell = 0; cell < total; cell++) {
    const index = grid[cell]
    if (index < 0) continue
    if (filters[index] >= 15) cells[cell] = OPAQUE
    if (emits[index] > 0) {
      cells[cell] = emits[index]
      queue.push(cell)
    }
  }
  const layer = width * width
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]
    const level = cells[cell]
    if (level <= 1) continue
    const x = cell % width
    const z = Math.floor(cell / width) % width
    const y = Math.floor(cell / layer)
    for (const [nx, ny, nz] of NEIGHBORS) {
      const ax = x + nx
      const ay = y + ny
      const az = z + nz
      if (ax < 0 || ay < 0 || az < 0 || ax >= width || ay >= height || az >= width) continue
      const neighbor = cell + nx + nz * width + ny * layer
      if (cells[neighbor] === OPAQUE) continue
      const index = grid[neighbor]
      const next = level - Math.max(1, index < 0 ? 0 : filters[index])
      if (next > cells[neighbor]) {
        cells[neighbor] = next
        queue.push(neighbor)
      }
    }
  }
  return cells
}

// `input`: the slice's grid and per-cell arrays, its palette, origin and the sky light at the bot's head.
export const computeBlocks = (input: ComputeInput): BlocksData => {
  const {
    origin,
    width,
    height,
    palette,
    properties,
    emits,
    filters,
    grid,
    kinds,
    leafy,
    submerged,
    occludes,
    skyLight,
  } = input
  const radius = input.radius ?? VOXEL_RADIUS
  const indexOf = (x: number, y: number, z: number) => (y * width + z) * width + x

  const roofLayer = VOXEL_BELOW + ROOF_CUTOFF - 1
  const view = analyzeView({
    grid,
    occludes,
    palette,
    width,
    height,
    feetY: VOXEL_BELOW,
    center: radius,
    cutoffY: roofLayer + 1,
    skyLight,
  })

  // The faces of a block that border air (or water, glass, …).
  const faceMask = (x: number, y: number, z: number) => {
    const cell = indexOf(x, y, z)
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
    return mask
  }

  const positions: number[] = []
  const blocks: number[] = []
  const faces: number[] = []
  // Point lights (torches, lanterns, glowstone, …) for the ray-cast torch light: x, y, z, level per light.
  // Lava and fire stay with the spread light alone, since a lava lake would be hundreds of them.
  const emitters: number[] = []
  const pointLight = palette.map((name, index) => emits[index] > 0 && !/^(lava|fire|soul_fire)$/.test(name))
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < width; z++) {
      for (let x = 0; x < width; x++) {
        const cell = indexOf(x, y, z)
        const index = grid[cell]
        if (index < 0) {
          continue
        }
        if (pointLight[index]) emitters.push(x - radius, y - VOXEL_BELOW, z - radius, emits[index])
        let mask = faceMask(x, y, z)
        if (!(mask & 1) && y >= VOXEL_BELOW - CAP_DEPTH && y + 1 < height) {
          const above = indexOf(x, y + 1, z)
          if (occludes[above] && faceMask(x, y + 1, z)) mask |= CAP_BIT
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
          positions.push(x - radius, y - VOXEL_BELOW, z - radius)
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

  const data: BlocksData = {
    key: `${(hash >>> 0).toString(36)}:${JSON.stringify(properties)}:${palette.join(',')}`,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    radius,
    roofCutoff: ROOF_CUTOFF,
    environment: view.environment,
    // Copies: the kept slice's palette grows with later updates.
    palette: [...palette],
    properties: [...properties],
    positions,
    blocks,
    faces,
    // Derived from the blocks, so the key above already changes with it.
    light: { width, height, below: VOXEL_BELOW, cells: spreadLight({ grid, emits, filters, width, height }) },
    emitters,
  }
  return data
}
