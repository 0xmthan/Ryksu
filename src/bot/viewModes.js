// Works out where the bot is (outside, indoors or in a cave) and which blocks the watcher's view modes
// keep, from the block grid around it:
// - Indoors: the room is the open space at the bot's level that has a ceiling, spread out from the bot.
//   Only blocks above head height over that room (and its walls) count as roof, so trees and buildings
//   nearby stay whole.
// - Cave: the air the bot can reach, spread out in 3D. Blocks bordering it are the cave's shell; the
//   watcher keeps only those, so the rock around the cave doesn't hide it.

// Blocks caves are made of; enough of them around the bot (with no daylight) means a cave, not a house.
const NATURAL =
  /stone|deepslate|dirt|gravel|granite|diorite|andesite|tuff|calcite|_ore$|netherrack|basalt|blackstone|clay|sand|dripstone|moss|sculk|amethyst|bedrock|lava|water|magma|obsidian|mud|terracotta|grass_block|mycelium|podzol|snow|ice|lichen|roots|cobweb|soul_soil|nylium/
const CAVE_SHARE = 0.6
// Sky light at the bot's head below this (with a natural ceiling) counts as underground.
const CAVE_SKY_LIGHT = 8

const NEIGHBORS_3D = [
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
]
const NEIGHBORS_2D = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
]

// grid: palette index per cell (-1 empty); occludes: 1 where a solid full cube blocks the way.
// feetY / center: the bot's cell; cutoffY: the first layer counted as roof.
const analyzeView = ({ grid, occludes, palette, width, height, feetY, center, cutoffY, skyLight }) => {
  const indexOf = (x, y, z) => (y * width + z) * width + x
  const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < width && y < height && z < width
  const total = width * width * height

  // Air the bot can reach, flooding from its feet and head.
  const reached = new Uint8Array(total)
  const queueX = new Int16Array(total)
  const queueY = new Int16Array(total)
  const queueZ = new Int16Array(total)
  let head = 0
  let tail = 0
  for (const y of [feetY, feetY + 1]) {
    const cell = indexOf(center, y, center)
    if (y < height && !occludes[cell]) {
      reached[cell] = 1
      queueX[tail] = center
      queueY[tail] = y
      queueZ[tail] = center
      tail++
    }
  }
  while (head < tail) {
    const x = queueX[head]
    const y = queueY[head]
    const z = queueZ[head]
    head++
    for (const [dx, dy, dz] of NEIGHBORS_3D) {
      const nx = x + dx
      const ny = y + dy
      const nz = z + dz
      if (!inside(nx, ny, nz)) continue
      const cell = indexOf(nx, ny, nz)
      if (reached[cell] || occludes[cell]) continue
      reached[cell] = 1
      queueX[tail] = nx
      queueY[tail] = ny
      queueZ[tail] = nz
      tail++
    }
  }

  // The shell: blocks in or next to the reached air.
  const shell = new Uint8Array(total)
  let shellBlocks = 0
  let naturalBlocks = 0
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < width; z++) {
      for (let x = 0; x < width; x++) {
        const cell = indexOf(x, y, z)
        if (grid[cell] < 0) continue
        const touches =
          reached[cell] ||
          (y + 1 < height && reached[indexOf(x, y + 1, z)]) ||
          (y > 0 && reached[indexOf(x, y - 1, z)]) ||
          (z + 1 < width && reached[indexOf(x, y, z + 1)]) ||
          (z > 0 && reached[indexOf(x, y, z - 1)]) ||
          (x + 1 < width && reached[indexOf(x + 1, y, z)]) ||
          (x > 0 && reached[indexOf(x - 1, y, z)])
        if (!touches) continue
        shell[cell] = 1
        if (occludes[cell]) {
          shellBlocks++
          if (NATURAL.test(palette[grid[cell]])) naturalBlocks++
        }
      }
    }
  }

  // Lowest solid block above head height in each column (-1: open sky, as far as the view goes).
  const ceiling = new Int16Array(width * width).fill(-1)
  for (let z = 0; z < width; z++) {
    for (let x = 0; x < width; x++) {
      for (let y = cutoffY; y < height; y++) {
        if (occludes[indexOf(x, y, z)]) {
          ceiling[z * width + x] = y
          break
        }
      }
    }
  }

  const botColumn = center * width + center
  const covered = ceiling[botColumn] >= 0
  let environment = 'outside'
  if (covered) {
    const natural = shellBlocks > 0 && naturalBlocks / shellBlocks >= CAVE_SHARE
    const dark = skyLight == null || skyLight < CAVE_SKY_LIGHT
    environment = natural && dark ? 'cave' : 'indoors'
  }

  // The room: covered columns open at the bot's level, spread out from the bot; then its walls.
  const room = new Uint8Array(width * width)
  if (covered) {
    const open = (x, z) =>
      ceiling[z * width + x] >= 0 &&
      (!occludes[indexOf(x, feetY, z)] || (feetY + 1 < height && !occludes[indexOf(x, feetY + 1, z)]))
    const columns = [[center, center]]
    room[botColumn] = 1
    for (let i = 0; i < columns.length; i++) {
      const [x, z] = columns[i]
      for (const [dx, dz] of NEIGHBORS_2D) {
        const nx = x + dx
        const nz = z + dz
        if (nx < 0 || nz < 0 || nx >= width || nz >= width || room[nz * width + nx] || !open(nx, nz)) continue
        room[nz * width + nx] = 1
        columns.push([nx, nz])
      }
    }
    // Walls: every column next to the room, corners included.
    const walls = []
    for (let z = 0; z < width; z++) {
      for (let x = 0; x < width; x++) {
        if (room[z * width + x]) continue
        let nextToRoom = false
        for (let dz = -1; dz <= 1 && !nextToRoom; dz++) {
          for (let dx = -1; dx <= 1 && !nextToRoom; dx++) {
            const nx = x + dx
            const nz = z + dz
            nextToRoom = nx >= 0 && nz >= 0 && nx < width && nz < width && room[nz * width + nx] === 1
          }
        }
        if (nextToRoom) walls.push(z * width + x)
      }
    }
    for (const column of walls) room[column] = 2
  }

  return {
    environment,
    shell,
    // Whether a cell's column is part of the room or its walls.
    inRoom: (x, z) => room[z * width + x] > 0,
  }
}

module.exports = { analyzeView }
