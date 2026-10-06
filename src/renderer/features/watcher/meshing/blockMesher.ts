// Turns the bot's block data into textured meshes for the 3D watcher. Each block is built from its real
// Minecraft model (picked by its state, e.g. facing or axis), every face cut from one texture atlas and
// shaded per side like the game, so the whole view is a few draw calls.
import * as THREE from 'three'
import blockData from '../../../../generated/blockModels.json'
import type { BlockView } from '../../../../shared/types'
import type { BlockAtlas } from './blockAtlas'
import { blockColor } from '../../../lib/blockColors'
import { blockVisibility, CAP_BIT, type ViewMode } from '../viewMode'
import { isTrue } from '../../../../shared/blocks'

type Blocks = BlockView

type Face = { t: number; uv: number[]; r?: number; c?: number; tint?: number }
type Element = {
  from: number[]
  to: number[]
  rot?: { origin: number[]; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean }
  noShade?: number
  faces: Record<string, Face>
}
// `w`: the weight among alternatives (default 1).
type Apply = { m: number; x?: number; y?: number; w?: number }
type Condition = Record<string, string> | { OR: Condition[] } | { AND: Condition[] }
// Each Apply[] is a set of alternatives, one picked per block position (see pickApplies).
type BlockEntry = {
  variants?: [Record<string, string>, Apply[]][]
  multipart?: [Condition | null, Apply[]][]
  tint?: string
  translucent?: number
}

const data = blockData as unknown as {
  textures: { src: string; size: number }[]
  models: Element[][]
  blocks: Record<string, BlockEntry>
}

// Face order matches the bot side: up, down, north (-z), south (+z), west (-x), east (+x).
const DIRECTIONS: [number, number, number][] = [
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
]
// Corners of each face as 0/1 picks between the element's from and to, counter-clockwise seen from
// outside, starting at the texture's bottom-left.
const FACE_CORNERS: [number, number, number][][] = [
  [
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
  [
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
  [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
  ],
  [
    [1, 0, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
  ],
]
// Bottom-left, bottom-right, top-right, top-left.
const CORNER_UV = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]
// The game's fixed side shading: top full bright, bottom darkest, north/south brighter than east/west.
const FACE_SHADE = [1, 0.5, 0.8, 0.8, 0.6, 0.6].map((shade) =>
  new THREE.Color().setScalar(shade).convertSRGBToLinear()
)
const FULL_BRIGHT = new THREE.Color(1, 1, 1)
// Ambient occlusion: a face's corner darkens by how many of the three blocks around it (in front of the
// face) are solid, like the game's smooth lighting. Both sides solid is as dark as all three. In sRGB,
// turned linear like the face shades.
const AO_SHADE = [1, 0.8, 0.66, 0.54].map((shade) => Math.pow(shade, 2.2))

// Liquid level (0-1 of a block) by flow level: a source is 8/9 high and each level drops another ninth.
const levelHeight = (properties: Record<string, unknown> | undefined) => {
  const level = Number(properties?.level ?? 0)
  return level >= 8 ? 8 / 9 : (8 - level) / 9
}
// See-through blocks that need blending rather than the cut-out used for leaves and glass panes.
const TRANSLUCENT = /stained_glass(?!_pane)|^ice$|frosted_ice|slime_block|honey_block/

const WATER_PLANTS = new Set(['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column'])
const isSubmerged = (name: string, properties?: Record<string, unknown>) =>
  WATER_PLANTS.has(name) || isTrue(properties?.waterlogged)

const WATER_APPLIES: Apply[] = data.blocks['water']?.variants?.[0]?.[1] ?? [{ m: 40 }]
const WATER_TINT_HEX = data.blocks['water']?.tint ?? '#3f76e4'

const matches = (properties: Record<string, unknown>, condition: Condition | null): boolean => {
  if (!condition) return true
  if ('OR' in condition) return (condition.OR as Condition[]).some((part) => matches(properties, part))
  if ('AND' in condition) return (condition.AND as Condition[]).every((part) => matches(properties, part))
  return Object.entries(condition as Record<string, string>).every(([key, value]) =>
    String(value).split('|').includes(String(properties[key]))
  )
}

// The models (with rotations) a block state is drawn with: one set of alternatives per part.
const modelsFor = (name: string, properties: Record<string, unknown>): Apply[][] | null => {
  const entry = data.blocks[name]
  if (!entry) return null
  if (entry.variants) {
    const variant = entry.variants.find(([condition]) => matches(properties, condition))
    const list = variant ? variant[1] : entry.variants[0]?.[1]
    return list ? [list] : null
  }
  return (entry.multipart ?? []).filter(([when]) => matches(properties, when)).map(([, list]) => list)
}

// Picks one alternative per part for the block at a world position, by weight, the same every time, so
// grass, dirt, stone, … turn and mirror from block to block like the game's instead of tiling.
const pickApplies = (parts: Apply[][], x: number, y: number, z: number): Apply[] => {
  let seed = 0
  // A part whose models were all missing at generation has no alternatives; it draws nothing.
  return parts
    .filter((list) => list.length > 0)
    .map((list, part) => {
      if (list.length === 1) return list[0]
      if (!seed) {
        seed = Math.imul(x, 3129871) ^ Math.imul(z, 116129781) ^ y
        seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b)
        seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b)
        seed = (seed ^ (seed >>> 16)) >>> 0 || 1
      }
      const total = list.reduce((sum, apply) => sum + (apply.w ?? 1), 0)
      let roll = ((((seed + Math.imul(part, 0x9e3779b9)) >>> 0) % 1000003) / 1000003) * total
      for (const apply of list) {
        roll -= apply.w ?? 1
        if (roll < 0) return apply
      }
      return list[list.length - 1]
    })
}

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }
const CENTER = new THREE.Vector3(8, 8, 8)
const ZERO = new THREE.Vector3()

// Rotates a point (in 0-16 model units) about `origin`, in place.
const rotate = (point: THREE.Vector3, axis: 'x' | 'y' | 'z', degrees: number, origin: THREE.Vector3) => {
  if (!degrees) return point
  return point.sub(origin).applyAxisAngle(AXES[axis], THREE.MathUtils.degToRad(degrees)).add(origin)
}

// Blockstate rotations turn clockwise seen from +x / from above, which is negative about three.js axes.
const rotateBlock = (point: THREE.Vector3, apply: Apply, origin = CENTER) => {
  rotate(point, 'x', -(apply.x ?? 0), origin)
  return rotate(point, 'y', -(apply.y ?? 0), origin)
}

const nearestDirection = (vector: THREE.Vector3) => {
  let best = 0
  let bestDot = -Infinity
  for (let index = 0; index < DIRECTIONS.length; index++) {
    const [x, y, z] = DIRECTIONS[index]
    const dot = vector.x * x + vector.y * y + vector.z * z
    if (dot > bestDot) {
      bestDot = dot
      best = index
    }
  }
  return best
}

type MeshBuffers = {
  positions: number[]
  uvs: number[]
  colors: number[]
  // The block cell each vertex belongs to, so the watcher can fade whole blocks that hide the bot.
  cells: number[]
  // Per vertex, the quad's facing (for the sun and shadows), written as each quad is made.
  normals: number[]
  // Block light (0-1) per vertex, for the warm glow of torches and the like (see watcher/blockLight.ts).
  light: number[]
  indices: number[]
  quadBlocks: number[]
}

const emptyBuffers = (): MeshBuffers => ({
  positions: [],
  uvs: [],
  colors: [],
  cells: [],
  normals: [],
  light: [],
  indices: [],
  quadBlocks: [],
})

const toGeometry = (buffers: MeshBuffers) => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3))
  geometry.setAttribute('cell', new THREE.Float32BufferAttribute(buffers.cells, 3))
  geometry.setAttribute('blockLight', new THREE.Float32BufferAttribute(buffers.light, 1))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3))
  geometry.setIndex(buffers.indices)
  geometry.computeBoundingSphere()
  return geometry
}

export type BlockMeshes = {
  opaque: THREE.BufferGeometry
  translucent: THREE.BufferGeometry
  // Water on its own, for its own shading (src/renderer/features/watcher/scene/water.ts).
  water: THREE.BufferGeometry
  // The roof over the bot's room, drawn faintly so the room shows through.
  ghost: THREE.BufferGeometry
  // Tops of blocks under solid blocks, tagged with the cell above: shown (darkened) only while that
  // block is a see-through hologram.
  caps: THREE.BufferGeometry
  // Which block (index into the payload) each quad belongs to, for hover lookups.
  opaqueQuads: number[]
  translucentQuads: number[]
  waterQuads: number[]
  capQuads: number[]
}

// A plain colored cube for blocks newer than the generated models.
const FALLBACK_MODEL: Element[] = [
  {
    from: [0, 0, 0],
    to: [16, 16, 16],
    faces: Object.fromEntries(DIRECTIONS.map((_, index) => [index, { t: -1, uv: [0, 0, 16, 16], c: index }])),
  },
]

// Smooth block light at a point (block units, relative to the origin), blended from the 8 cells around
// it like the game's smooth lighting. Cells light can't enter are left out, so walls don't darken corners.
const OPAQUE_LIGHT = 255
const lightSampler = (light: Blocks['light'] | undefined) => {
  if (!light) return () => 0
  const { width, height, below, cells } = light
  const radius = (width - 1) / 2
  return (px: number, py: number, pz: number) => {
    // Cell centers sit at whole numbers plus a half.
    const ux = px + radius - 0.5
    const uy = py + below - 0.5
    const uz = pz + radius - 0.5
    const x0 = Math.floor(ux)
    const y0 = Math.floor(uy)
    const z0 = Math.floor(uz)
    const fx = ux - x0
    const fy = uy - y0
    const fz = uz - z0
    let sum = 0
    let weights = 0
    for (let dy = 0; dy < 2; dy++) {
      const y = y0 + dy
      if (y < 0 || y >= height) continue
      const wy = dy ? fy : 1 - fy
      for (let dz = 0; dz < 2; dz++) {
        const z = z0 + dz
        if (z < 0 || z >= width) continue
        const wz = wy * (dz ? fz : 1 - fz)
        for (let dx = 0; dx < 2; dx++) {
          const x = x0 + dx
          if (x < 0 || x >= width) continue
          const level = cells[(y * width + z) * width + x]
          if (level === OPAQUE_LIGHT) continue
          const weight = wz * (dx ? fx : 1 - fx)
          sum += level * weight
          weights += weight
        }
      }
    }
    return weights > 0.0001 ? sum / weights / 15 : 0
  }
}

// Block index by cell for one payload, shared by every chunk built from it (liquids look at neighbors).
const cellKey = (x: number, y: number, z: number) => ((x + 128) * 256 + (y + 128)) * 256 + (z + 128)
const cellMaps = new WeakMap<Blocks, Map<number, number>>()
const cellMapOf = (blocks: Blocks) => {
  let map = cellMaps.get(blocks)
  if (!map) {
    map = new Map()
    for (let i = 0; i < blocks.blocks.length; i++) {
      map.set(cellKey(blocks.positions[i * 3], blocks.positions[i * 3 + 1], blocks.positions[i * 3 + 2]), i)
    }
    cellMaps.set(blocks, map)
  }
  return map
}

// Builds the meshes for the blocks at `indices` (every block when left out), so the watcher can build and
// rebuild one chunk at a time.
export type MeshOptions = { ambientOcclusion?: boolean }

export const buildBlockMeshes = (
  blocks: Blocks,
  atlas: BlockAtlas,
  mode: ViewMode,
  indices?: ArrayLike<number>,
  options: MeshOptions = {}
): BlockMeshes => {
  const lightAt = lightSampler(blocks.light)
  // Solid, light-blocking cells (full blocks), from the light grid; null without one, which skips the shading.
  const solidAt = (() => {
    const light = blocks.light
    if (!options.ambientOcclusion || !light) return null
    const { width, height, below, cells } = light
    const radius = (width - 1) / 2
    return (x: number, y: number, z: number) => {
      const cx = x + radius
      const cy = y + below
      const cz = z + radius
      if (cx < 0 || cz < 0 || cy < 0 || cx >= width || cz >= width || cy >= height) return false
      return cells[(cy * width + cz) * width + cx] === OPAQUE_LIGHT
    }
  })()
  const vertexAo = [1, 1, 1, 1]
  const opaque = emptyBuffers()
  const translucent = emptyBuffers()
  const water = emptyBuffers()
  const ghost = emptyBuffers()
  const caps = emptyBuffers()
  // Color.set() converts hex from sRGB to the linear space three.js works in.
  const color = new THREE.Color()
  const tint = new THREE.Color()
  const corner = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const cornerUvs: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ]
  const resolved = new Map<number, Apply[][] | null>()

  const renderElements = (
    targetBuffers: MeshBuffers,
    applies: Apply[] | null | undefined,
    entryTint: string | undefined,
    surfaceHeight: number,
    targetMask: number,
    customFallbackColor: THREE.Color | null,
    bx: number,
    by: number,
    bz: number,
    blockIndex: number,
    // The cell the vertices are tagged with (caps take the block above's); faces without a neighbor
    // to cull against are left out when `cullOnly`.
    cellY = by,
    cullOnly = false,
    // Liquid surfaces: the top corners' heights (0-16) by corner, [x0z0, x1z0, x0z1, x1z1], so the
    // surface slopes from block to block like the game's instead of stepping.
    topHeights: number[] | null = null
  ) => {
    if (entryTint) {
      tint.set(entryTint)
    }
    for (const apply of applies ?? [{ m: -1 }]) {
      const baseElements = apply.m >= 0 ? data.models[apply.m] : FALLBACK_MODEL
      if (!baseElements) continue
      const elements =
        surfaceHeight < 16
          ? baseElements.map((element) => ({ ...element, to: [element.to[0], surfaceHeight, element.to[2]] }))
          : baseElements
      for (const element of elements) {
        const rotation = element.rot
        const rotationOrigin = rotation ? new THREE.Vector3(...rotation.origin) : CENTER
        // "rescale" stretches 45° crosses so they still span the whole block.
        const rescale = rotation?.rescale
          ? 1 / Math.cos(THREE.MathUtils.degToRad(Math.abs(rotation.angle)))
          : 1

        for (const [faceKey, face] of Object.entries(element.faces)) {
          const direction = Number(faceKey)
          // Faces flush with a neighbor only show where the bot said that side is open.
          if (face.c !== undefined) {
            normal.set(...DIRECTIONS[face.c])
            if (!(targetMask & (1 << nearestDirection(rotateBlock(normal, apply, ZERO))))) {
              continue
            }
          } else if (cullOnly) {
            continue
          }

          normal.set(...DIRECTIONS[direction])
          if (rotation) {
            rotate(normal, rotation.axis, rotation.angle, ZERO)
          }
          const facing = nearestDirection(rotateBlock(normal, apply, ZERO))
          const shade = element.noShade ? FULL_BRIGHT : FACE_SHADE[facing]

          if (customFallbackColor) {
            color.copy(customFallbackColor).multiply(shade)
          } else {
            color.copy(shade)
            if (face.tint && entryTint) {
              color.multiply(tint)
            }
          }

          // Face UVs are [u1, v1, u2, v2] with v down; a rotation turns the texture clockwise.
          const [u1, v1, u2, v2] = face.uv
          const turns = ((face.r ?? 0) / 90) % 4
          for (let k = 0; k < 4; k++) {
            const [cu, cv] = CORNER_UV[(k + turns) % 4]
            cornerUvs[k] = face.t >= 0 ? atlas.uv(face.t, u1 + cu * (u2 - u1), v2 + cv * (v1 - v2)) : [0, 0]
          }
          // Nudge UVs a hair toward the face center so neighboring atlas tiles never bleed in.
          const centerU = (cornerUvs[0][0] + cornerUvs[2][0]) / 2
          const centerV = (cornerUvs[0][1] + cornerUvs[2][1]) / 2

          const base = targetBuffers.positions.length / 3
          // Only faces flush with the block's side (the ones a neighbor can cover) are shaded; small parts
          // like a torch's, and liquid surfaces, keep their flat shade.
          const occlude = solidAt !== null && face.c !== undefined && !cullOnly && !topHeights
          const [fx, fy, fz] = DIRECTIONS[facing]
          FACE_CORNERS[direction].forEach(([cx, cy, cz], k) => {
            corner.set(
              element.from[0] + cx * (element.to[0] - element.from[0]),
              topHeights && cy
                ? topHeights[cx + cz * 2]
                : element.from[1] + cy * (element.to[1] - element.from[1]),
              element.from[2] + cz * (element.to[2] - element.from[2])
            )
            if (rotation) {
              rotate(corner, rotation.axis, rotation.angle, rotationOrigin)
              if (rescale !== 1) {
                for (const axis of ['x', 'y', 'z'] as const) {
                  if (axis !== rotation.axis) {
                    corner[axis] = rotationOrigin[axis] + (corner[axis] - rotationOrigin[axis]) * rescale
                  }
                }
              }
            }
            rotateBlock(corner, apply)
            const vx = bx + corner.x / 16
            const vy = by + corner.y / 16
            const vz = bz + corner.z / 16
            targetBuffers.positions.push(vx, vy, vz)
            // Sampled half a block out from the face, so a face takes the light of the space in front of it.
            targetBuffers.light.push(lightAt(vx + normal.x * 0.5, vy + normal.y * 0.5, vz + normal.z * 0.5))
            const [u, v] = cornerUvs[k]
            targetBuffers.uvs.push(u + (centerU - u) * 0.001, v + (centerV - v) * 0.001)
            let ao = 1
            if (occlude) {
              // The two directions along the face toward this corner (0 where the corner isn't near an
              // edge, e.g. the top of a slab's side), and the blocks there in the layer in front.
              const toward = (offset: number) => (offset > 0.25 ? 1 : offset < -0.25 ? -1 : 0)
              const sx = fx ? 0 : toward(vx - bx - 0.5)
              const sy = fy ? 0 : toward(vy - by - 0.5)
              const sz = fz ? 0 : toward(vz - bz - 0.5)
              const ox = bx + fx
              const oy = by + fy
              const oz = bz + fz
              // Splits the tangent steps into the face's two axes.
              const [ax, ay, az, bx2, by2, bz2] = fx
                ? [0, sy, 0, 0, 0, sz]
                : fy
                  ? [sx, 0, 0, 0, 0, sz]
                  : [sx, 0, 0, 0, sy, 0]
              const sideA = (ax || ay || az) !== 0 && solidAt!(ox + ax, oy + ay, oz + az)
              const sideB = (bx2 || by2 || bz2) !== 0 && solidAt!(ox + bx2, oy + by2, oz + bz2)
              const cornerSolid =
                (ax || ay || az) !== 0 &&
                (bx2 || by2 || bz2) !== 0 &&
                solidAt!(ox + ax + bx2, oy + ay + by2, oz + az + bz2)
              ao = AO_SHADE[sideA && sideB ? 3 : Number(sideA) + Number(sideB) + Number(cornerSolid)]
            }
            vertexAo[k] = ao
            targetBuffers.colors.push(color.r * ao, color.g * ao, color.b * ao)
            targetBuffers.cells.push(bx, cellY, bz)
          })
          // The quad's facing from its diagonals: flat per face (a sloped liquid top gets its slope).
          {
            const p = targetBuffers.positions
            const o = base * 3
            const ax = p[o + 6] - p[o]
            const ay = p[o + 7] - p[o + 1]
            const az = p[o + 8] - p[o + 2]
            const bx = p[o + 9] - p[o + 3]
            const by = p[o + 10] - p[o + 4]
            const bz = p[o + 11] - p[o + 5]
            let nx = ay * bz - az * by
            let ny = az * bx - ax * bz
            let nz = ax * by - ay * bx
            const length = Math.hypot(nx, ny, nz) || 1
            nx /= length
            ny /= length
            nz /= length
            targetBuffers.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz)
          }
          // A sloped liquid top folds along the diagonal whose ends are closest in height, so a raised
          // corner makes one flat triangle and a ramp rather than a tent.
          const heightAt = (k: number) => {
            const [cx, , cz] = FACE_CORNERS[direction][k]
            return topHeights![cx + cz * 2]
          }
          if (
            topHeights &&
            direction === 0 &&
            Math.abs(heightAt(1) - heightAt(3)) < Math.abs(heightAt(0) - heightAt(2))
          ) {
            targetBuffers.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base)
          } else if (occlude && vertexAo[0] + vertexAo[2] > vertexAo[1] + vertexAo[3]) {
            // Folded along the darker diagonal, so a shaded corner fades evenly into both triangles
            // instead of cutting a hard triangle across the face.
            targetBuffers.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base)
          } else {
            targetBuffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
          }
          targetBuffers.quadBlocks.push(blockIndex)
        }
      }
    }
  }

  const byCell = cellMapOf(blocks)
  // The liquid (`water` also counts waterlogged blocks) a block holds, or null.
  const liquidOf = (index: number) => {
    const name = blocks.palette[blocks.blocks[index]]
    if (name === 'water' || name === 'lava') return name
    return isSubmerged(name, blocks.properties?.[blocks.blocks[index]]) ? 'water' : null
  }
  const liquidAt = (x: number, y: number, z: number, liquid: string) => {
    const index = byCell.get(cellKey(x, y, z))
    return index !== undefined && liquidOf(index) === liquid ? index : null
  }
  // The mask bit of the side facing (dx, dz).
  const sideBit = (dx: number, dz: number) => 1 << (dx > 0 ? 5 : dx < 0 ? 4 : dz > 0 ? 3 : 2)
  // Each top corner's height, averaged from the four cells sharing it as the game does: full when any has
  // the same liquid on top; sources weigh more; open air pulls it down. Only what all four cells agree on
  // is used (air is a cell a liquid beside it shows a face to), so neighbors meet without cracks.
  const liquidCorners = (index: number, liquid: string) => {
    const x = blocks.positions[index * 3]
    const y = blocks.positions[index * 3 + 1]
    const z = blocks.positions[index * 3 + 2]
    const heightOf = (cell: number) =>
      blocks.palette[blocks.blocks[cell]] === liquid
        ? levelHeight(blocks.properties?.[blocks.blocks[cell]])
        : 8 / 9
    const corners = [0, 0, 0, 0]
    for (let corner = 0; corner < 4; corner++) {
      const dx = corner & 1 ? 1 : -1
      const dz = corner & 2 ? 1 : -1
      const group: [number, number][] = [
        [x, z],
        [x + dx, z],
        [x, z + dz],
        [x + dx, z + dz],
      ]
      const cells = group.map(([cx, cz]) => liquidAt(cx, y, cz, liquid))
      let total = 0
      let weight = 0
      let full = false
      group.forEach(([cx, cz], k) => {
        const cell = cells[k]
        if (cell === null) {
          // Air when a liquid cell next to it in the group has an open side toward it.
          const open = group.some(([px, pz], j) => {
            const neighbor = cells[j]
            return (
              neighbor !== null &&
              Math.abs(px - cx) + Math.abs(pz - cz) === 1 &&
              Boolean(blocks.faces[neighbor] & sideBit(cx - px, cz - pz))
            )
          })
          if (open) weight += 1
          return
        }
        if (liquidAt(cx, y + 1, cz, liquid) !== null) full = true
        const height = heightOf(cell)
        const w = height >= 0.8 ? 10 : 1
        total += height * w
        weight += w
      })
      corners[corner] = (full ? 1 : weight ? total / weight : heightOf(index)) * 16
    }
    return corners
  }

  const count = indices ? indices.length : blocks.blocks.length
  for (let n = 0; n < count; n++) {
    const i = indices ? indices[n] : n
    const x = blocks.positions[i * 3]
    const y = blocks.positions[i * 3 + 1]
    const z = blocks.positions[i * 3 + 2]
    const visible = blockVisibility(mode, y, blocks.roofCutoff, blocks.faces[i])
    const capped = mode !== 'cave' && Boolean(blocks.faces[i] & CAP_BIT)
    if (!visible && !capped) {
      continue
    }

    const paletteIndex = blocks.blocks[i]
    const name = blocks.palette[paletteIndex]
    if (!resolved.has(paletteIndex)) {
      resolved.set(paletteIndex, modelsFor(name, blocks.properties?.[paletteIndex] ?? {}))
    }
    const parts = resolved.get(paletteIndex)
    const applied = parts
      ? pickApplies(parts, blocks.origin.x + x, blocks.origin.y + y, blocks.origin.z + z)
      : null
    const entry = data.blocks[name]
    if (capped && name !== 'water' && name !== 'lava') {
      const capColor = applied ? null : new THREE.Color(blockColor(name))
      renderElements(caps, applied, entry?.tint, 16, 1, capColor, x, y, z, i, y + 1, true)
    }
    if (!visible) {
      continue
    }
    const mask = visible.mask
    const buffers = visible.ghost
      ? ghost
      : name === 'water'
        ? water
        : entry?.translucent || TRANSLUCENT.test(name)
          ? translucent
          : opaque
    const fallbackColor = applied ? null : new THREE.Color(blockColor(name))

    const isLiquid = name === 'water' || name === 'lava'
    // Covered by more liquid (or anything) it fills the block; open on top, its surface slopes.
    const corners = isLiquid && mask & 1 ? liquidCorners(i, name) : null
    // The generated lava entry carries the grass tint; lava has none.
    const tintHex = name === 'lava' ? undefined : entry?.tint

    renderElements(buffers, applied, tintHex, 16, mask, fallbackColor, x, y, z, i, y, false, corners)

    if (name !== 'water' && isSubmerged(name, blocks.properties?.[paletteIndex])) {
      const waterBuffers = visible.ghost ? ghost : water
      const waterCorners = mask & 1 ? liquidCorners(i, 'water') : null
      renderElements(
        waterBuffers,
        WATER_APPLIES,
        WATER_TINT_HEX,
        16,
        mask,
        null,
        x,
        y,
        z,
        i,
        y,
        false,
        waterCorners
      )
    }
  }

  return {
    opaque: toGeometry(opaque),
    translucent: toGeometry(translucent),
    water: toGeometry(water),
    ghost: toGeometry(ghost),
    caps: toGeometry(caps),
    opaqueQuads: opaque.quadBlocks,
    translucentQuads: translucent.quadBlocks,
    waterQuads: water.quadBlocks,
    capQuads: caps.quadBlocks,
  }
}
