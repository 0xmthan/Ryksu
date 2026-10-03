// Turns the bot's block data into textured meshes for the 3D watcher. Each block is built from its real
// Minecraft model (picked by its state, e.g. facing or axis), every face cut from one texture atlas and
// shaded per side like the game, so the whole view is two draw calls.
import * as THREE from 'three'
import blockData from '../generated/blockModels.json'
import type { WorldView } from '../types'
import { blockColor } from './blockColors'

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

const TILE = 16
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
const ROOF_FACE_BIT = 1 << 6

// Liquid surfaces sit below the top of the block: a source is 8/9 high and each flow level drops
// another ninth. Under more liquid (top face hidden) or falling (level 8+) it fills the block.
const liquidHeight = (properties: Record<string, unknown>, topOpen: boolean) => {
  const level = Number(properties.level ?? 0)
  return !topOpen || level >= 8 ? 16 : ((8 - level) / 9) * 16
}
// See-through blocks that need blending rather than the cut-out used for leaves and glass panes.
const TRANSLUCENT = /stained_glass(?!_pane)|^ice$|frosted_ice|slime_block|honey_block/

export type BlockAtlas = {
  texture: THREE.Texture
  // Atlas UV of a point in a texture, given in the 0-16 units block models use.
  uv: (texture: number, u: number, v: number) => [number, number]
}

let atlasPromise: Promise<BlockAtlas> | null = null

// Built once on first use: every texture's first frame packed into one canvas. Sizes are powers of two
// (16px blocks, 64px chests), so placing each on a multiple of its own size packs without gaps.
export const loadBlockAtlas = (): Promise<BlockAtlas> => {
  atlasPromise ??= (async () => {
    const images = await Promise.all(
      data.textures.map(async ({ src }) => {
        const image = new Image()
        image.src = src
        await image.decode()
        return image
      })
    )
    const spans = data.textures.map(({ size }) => Math.max(1, Math.ceil(size / TILE)))
    const area = spans.reduce((total, span) => total + span * span, 0)
    let columns = 2 ** Math.ceil(Math.log2(Math.ceil(Math.sqrt(area))))
    let placements: [number, number][] = []

    const pack = () => {
      const used = new Uint8Array(columns * columns)
      const order = spans.map((_, index) => index).sort((a, b) => spans[b] - spans[a])
      const result: [number, number][] = []
      for (const index of order) {
        const span = spans[index]
        let spot: [number, number] | null = null
        for (let row = 0; row + span <= columns && !spot; row += span) {
          for (let column = 0; column + span <= columns && !spot; column += span) {
            if (!used[row * columns + column]) {
              spot = [column, row]
            }
          }
        }
        if (!spot) return null
        for (let dy = 0; dy < span; dy++) {
          used.fill(1, (spot[1] + dy) * columns + spot[0], (spot[1] + dy) * columns + spot[0] + span)
        }
        result[index] = spot
      }
      return result
    }
    for (let packed = pack(); ; packed = pack()) {
      if (packed) {
        placements = packed
        break
      }
      columns *= 2
    }

    const size = columns * TILE
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')!
    context.imageSmoothingEnabled = false
    images.forEach((image, index) => {
      // Animated textures are vertical strips of square frames; take the first.
      const frame = image.naturalWidth
      const [column, row] = placements[index]
      const span = spans[index] * TILE
      context.drawImage(image, 0, 0, frame, frame, column * TILE, row * TILE, span, span)
    })

    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false

    return {
      texture,
      uv: (index, u, v) => {
        const [column, row] = placements[index]
        const span = spans[index] * TILE
        return [(column * TILE + (u / 16) * span) / size, (row * TILE + (v / 16) * span) / size]
      },
    }
  })()
  return atlasPromise
}

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
  indices: number[]
  quadBlocks: number[]
}

const emptyBuffers = (): MeshBuffers => ({ positions: [], uvs: [], colors: [], indices: [], quadBlocks: [] })

const toGeometry = (buffers: MeshBuffers) => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3))
  geometry.setIndex(buffers.indices)
  geometry.computeBoundingSphere()
  return geometry
}

export type BlockMeshes = {
  opaque: THREE.BufferGeometry
  translucent: THREE.BufferGeometry
  // Which block (index into the payload) each quad belongs to, for hover lookups.
  opaqueQuads: number[]
  translucentQuads: number[]
}

// A plain colored cube for blocks newer than the generated models.
const FALLBACK_MODEL: Element[] = [
  {
    from: [0, 0, 0],
    to: [16, 16, 16],
    faces: Object.fromEntries(DIRECTIONS.map((_, index) => [index, { t: -1, uv: [0, 0, 16, 16], c: index }])),
  },
]

export const buildBlockMeshes = (blocks: Blocks, atlas: BlockAtlas, hideRoof: boolean): BlockMeshes => {
  const opaque = emptyBuffers()
  const translucent = emptyBuffers()
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

  for (let i = 0; i < blocks.blocks.length; i++) {
    const x = blocks.positions[i * 3]
    const y = blocks.positions[i * 3 + 1]
    const z = blocks.positions[i * 3 + 2]
    if (hideRoof && y >= blocks.roofCutoff) {
      continue
    }
    let mask = blocks.faces[i]
    if (hideRoof && mask & ROOF_FACE_BIT) {
      mask |= 1
    }
    if (!(mask & 0b111111)) {
      continue
    }

    const paletteIndex = blocks.blocks[i]
    const name = blocks.palette[paletteIndex]
    if (!resolved.has(paletteIndex)) {
      resolved.set(paletteIndex, modelsFor(name, blocks.properties?.[paletteIndex] ?? {}))
    }
    const applied = resolved.get(paletteIndex)
    const entry = data.blocks[name]
    const buffers = entry?.translucent || TRANSLUCENT.test(name) ? translucent : opaque
    if (entry?.tint) {
      tint.set(entry.tint)
    }
    const fallbackColor = applied ? null : new THREE.Color(blockColor(name))

    const isLiquid = name === 'water' || name === 'lava'
    const surface = isLiquid ? liquidHeight(blocks.properties?.[paletteIndex] ?? {}, Boolean(mask & 1)) : 16

    for (const apply of applied ?? [{ m: -1 }]) {
      const baseElements = apply.m >= 0 ? data.models[apply.m] : FALLBACK_MODEL
      const elements =
        surface < 16
          ? baseElements.map((element) => ({ ...element, to: [element.to[0], surface, element.to[2]] }))
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
            if (!(mask & (1 << nearestDirection(rotateBlock(normal, apply, ZERO))))) {
              continue
            }
          }

          normal.set(...DIRECTIONS[direction])
          if (rotation) {
            rotate(normal, rotation.axis, rotation.angle, ZERO)
          }
          const shade = element.noShade
            ? FULL_BRIGHT
            : FACE_SHADE[nearestDirection(rotateBlock(normal, apply, ZERO))]

          if (fallbackColor) {
            color.copy(fallbackColor).multiply(shade)
          } else {
            color.copy(shade)
            if (face.tint && entry?.tint) {
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

          const base = buffers.positions.length / 3
          FACE_CORNERS[direction].forEach(([cx, cy, cz], k) => {
            corner.set(
              element.from[0] + cx * (element.to[0] - element.from[0]),
              element.from[1] + cy * (element.to[1] - element.from[1]),
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
            buffers.positions.push(x + corner.x / 16, y + corner.y / 16, z + corner.z / 16)
            const [u, v] = cornerUvs[k]
            buffers.uvs.push(u + (centerU - u) * 0.001, v + (centerV - v) * 0.001)
            buffers.colors.push(color.r, color.g, color.b)
          })
          buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
          buffers.quadBlocks.push(i)
        }
      }
    }
  }

  return {
    opaque: toGeometry(opaque),
    translucent: toGeometry(translucent),
    opaqueQuads: opaque.quadBlocks,
    translucentQuads: translucent.quadBlocks,
  }
}
