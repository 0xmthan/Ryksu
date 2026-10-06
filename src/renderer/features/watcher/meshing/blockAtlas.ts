// The block texture atlas for the 3D watcher: every block texture's first frame packed into one canvas.
import * as THREE from 'three'
import blockData from '../../../../generated/blockModels.json'

const blockTextures = (blockData as unknown as { textures: { src: string; size: number }[] }).textures

const TILE = 16
// Each texture gets a border of its own edge pixels repeated outward, so a pixel sampled just past a
// face's edge (antialiasing does this, most at a distance) picks up the same color instead of the
// neighboring texture, which showed as thin lines between blocks.
const GUTTER = 4
// The packing grid's cell: one 16px tile plus room for the gutter on both sides.
const CELL = TILE + GUTTER * 2

export type BlockAtlas = {
  texture: THREE.Texture
  // Atlas UV of a point in a texture, given in the 0-16 units block models use.
  uv: (texture: number, u: number, v: number) => [number, number]
}

let atlasPromise: Promise<BlockAtlas> | null = null

// Built once on first use: every texture's first frame packed into one canvas. Sizes are powers of two
// (16px blocks, 64px chests), so placing each on a multiple of its own size packs without gaps; a texture
// spanning several cells has gutter room to spare.
export const loadBlockAtlas = (): Promise<BlockAtlas> => {
  atlasPromise ??= (async () => {
    const images = await Promise.all(
      blockTextures.map(async ({ src }) => {
        const image = new Image()
        image.src = src
        await image.decode()
        return image
      })
    )
    const spans = blockTextures.map(({ size }) => Math.max(1, Math.ceil(size / TILE)))
    const area = spans.reduce((total, span) => total + span * span, 0)
    let columns = 2 ** Math.ceil(Math.log2(Math.ceil(Math.sqrt(area))))
    let placements: [number, number][] = []

    // Top-left pixel of a placed texture, inside its gutter.
    const origin = ([column, row]: [number, number]) => [column * CELL + GUTTER, row * CELL + GUTTER]

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

    const size = columns * CELL
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')!
    context.imageSmoothingEnabled = false
    images.forEach((image, index) => {
      // Animated textures are vertical strips of square frames; take the first.
      const frame = image.naturalWidth
      const [x, y] = origin(placements[index])
      const span = spans[index] * TILE
      context.drawImage(image, 0, 0, frame, frame, x, y, span, span)
      // Stretch the outermost rows and columns into the gutter; top and bottom last, to fill the corners.
      context.drawImage(canvas, x, y, 1, span, x - GUTTER, y, GUTTER, span)
      context.drawImage(canvas, x + span - 1, y, 1, span, x + span, y, GUTTER, span)
      context.drawImage(
        canvas,
        x - GUTTER,
        y,
        span + GUTTER * 2,
        1,
        x - GUTTER,
        y - GUTTER,
        span + GUTTER * 2,
        GUTTER
      )
      context.drawImage(
        canvas,
        x - GUTTER,
        y + span - 1,
        span + GUTTER * 2,
        1,
        x - GUTTER,
        y + span,
        span + GUTTER * 2,
        GUTTER
      )
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
        const [x, y] = origin(placements[index])
        const span = spans[index] * TILE
        return [(x + (u / 16) * span) / size, (y + (v / 16) * span) / size]
      },
    }
  })()
  return atlasPromise
}
