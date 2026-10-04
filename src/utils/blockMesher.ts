// Turns the bot's block data into textured meshes for the 3D watcher. Each block is built from its real
// Minecraft model (picked by its state, e.g. facing or axis), every face cut from one texture atlas and
// shaded per side like the game, so the whole view is a few draw calls.
import * as THREE from 'three'
import blockData from '../generated/blockModels.json'
import type { WorldView } from '../types'
import type { BlockAtlas } from './blockAtlas'
import { blockColor } from './blockColors'
import { blockVisibility, CAP_BIT, type ViewMode } from './viewMode'

type Blocks = WorldView['blocks']

type Face = { t: number; uv: number[]; r?: number; c?: number; tint?: number }
type Element = {
  from: number[]
  to: number[]
  rot?: { origin: number[]; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean }
  noShade?: number
  faces: Record<string, Face>
}
type Apply = { m: number; x?: number; y?: number }
type Condition = Record<string, string> | { OR: Condition[] } | { AND: Condition[] }
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

// Liquid level (0-1 of a block) by flow level: a source is 8/9 high and each level drops another ninth.
const levelHeight = (properties: Record<string, unknown> | undefined) => {
  const level = Number(properties?.level ?? 0)
  return level >= 8 ? 8 / 9 : (8 - level) / 9
}
// See-through blocks that need blending rather than the cut-out used for leaves and glass panes.
const TRANSLUCENT = /stained_glass(?!_pane)|^ice$|frosted_ice|slime_block|honey_block/

const WATER_PLANTS = new Set(['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column'])
const isSubmerged = (name: string, properties?: Record<string, unknown>) =>
  WATER_PLANTS.has(name) || properties?.waterlogged === true || properties?.waterlogged === 'true'

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

// The models (with rotations) a block state is drawn with.
const modelsFor = (name: string, properties: Record<string, unknown>): Apply[] | null => {
  const entry = data.blocks[name]
  if (!entry) return null
  if (entry.variants) {
    const variant = entry.variants.find(([condition]) => matches(properties, condition))
    return variant ? variant[1] : (entry.variants[0]?.[1] ?? null)
  }
  return (entry.multipart ?? []).filter(([when]) => matches(properties, when)).flatMap(([, list]) => list)
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
  DIRECTIONS.forEach(([x, y, z], index) => {
    const dot = vector.x * x + vector.y * y + vector.z * z
    if (dot > bestDot) {
      bestDot = dot
      best = index
    }
  })
  return best
}

type MeshBuffers = {
  positions: number[]
  uvs: number[]
  colors: number[]
  // The block cell each vertex belongs to, so the watcher can fade whole blocks that hide the bot.
  cells: number[]
  indices: number[]
  quadBlocks: number[]
}

const emptyBuffers = (): MeshBuffers => ({ positions: [], uvs: [], colors: [], cells: [], indices: [], quadBlocks: [] })

const toGeometry = (buffers: MeshBuffers) => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3))
  geometry.setAttribute('cell', new THREE.Float32BufferAttribute(buffers.cells, 3))
  geometry.setIndex(buffers.indices)
  // Every quad has its own corners, so these come out flat per face, for the sun and shadows.
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export type BlockMeshes = {
  opaque: THREE.BufferGeometry
  translucent: THREE.BufferGeometry
  // The roof over the bot's room, drawn faintly so the room shows through.
  ghost: THREE.BufferGeometry
  // Tops of blocks under solid blocks, tagged with the cell above: shown (darkened) only while that
  // block is a see-through hologram.
  caps: THREE.BufferGeometry
  // Which block (index into the payload) each quad belongs to, for hover lookups.
  opaqueQuads: number[]
  translucentQuads: number[]
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

export const buildBlockMeshes = (blocks: Blocks, atlas: BlockAtlas, mode: ViewMode): BlockMeshes => {
  const opaque = emptyBuffers()
  const translucent = emptyBuffers()
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
  const resolved = new Map<number, Apply[] | null>()

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
          const shade = element.noShade
            ? FULL_BRIGHT
            : FACE_SHADE[nearestDirection(rotateBlock(normal, apply, ZERO))]

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
          FACE_CORNERS[direction].forEach(([cx, cy, cz], k) => {
            corner.set(
              element.from[0] + cx * (element.to[0] - element.from[0]),
              topHeights && cy ? topHeights[cx + cz * 2] : element.from[1] + cy * (element.to[1] - element.from[1]),
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
            targetBuffers.positions.push(bx + corner.x / 16, by + corner.y / 16, bz + corner.z / 16)
            const [u, v] = cornerUvs[k]
            targetBuffers.uvs.push(u + (centerU - u) * 0.001, v + (centerV - v) * 0.001)
            targetBuffers.colors.push(color.r, color.g, color.b)
            targetBuffers.cells.push(bx, cellY, bz)
          })
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
          } else {
            targetBuffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
          }
          targetBuffers.quadBlocks.push(blockIndex)
        }
      }
    }
  }

  // Block index by cell, for liquids to look at their neighbors.
  const cellKey = (x: number, y: number, z: number) => ((x + 128) * 256 + (y + 128)) * 256 + (z + 128)
  const byCell = new Map<number, number>()
  for (let i = 0; i < blocks.blocks.length; i++) {
    byCell.set(cellKey(blocks.positions[i * 3], blocks.positions[i * 3 + 1], blocks.positions[i * 3 + 2]), i)
  }
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
      blocks.palette[blocks.blocks[cell]] === liquid ? levelHeight(blocks.properties?.[blocks.blocks[cell]]) : 8 / 9
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

  for (let i = 0; i < blocks.blocks.length; i++) {
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
    const applied = resolved.get(paletteIndex)
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
      const waterBuffers = visible.ghost ? ghost : translucent
      const waterCorners = mask & 1 ? liquidCorners(i, 'water') : null
      renderElements(waterBuffers, WATER_APPLIES, WATER_TINT_HEX, 16, mask, null, x, y, z, i, y, false, waterCorners)
    }
  }

  return {
    opaque: toGeometry(opaque),
    translucent: toGeometry(translucent),
    ghost: toGeometry(ghost),
    caps: toGeometry(caps),
    opaqueQuads: opaque.quadBlocks,
    translucentQuads: translucent.quadBlocks,
    capQuads: caps.quadBlocks,
  }
}
