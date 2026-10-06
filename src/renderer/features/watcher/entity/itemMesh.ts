// 3D items for the watcher, the way the game draws them in hands and on the ground: flat icons become a
// one-pixel-thick slab with sides wherever a pixel meets transparency; blocks become small cubes.
import * as THREE from 'three'
import { itemIcon } from '../../../lib/itemIcons'
import { loadImage, textureFromUrl } from './textures'

// Extruded geometry spanning -0.5..0.5 in x and y (texture up is +y), one pixel thick.
const extrude = (image: HTMLImageElement) => {
  const size = image.naturalWidth
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, size, size).data
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && pixels[(y * size + x) * 4 + 3] > 25

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const half = 0.5 / size
  // A quad from four corners (counter-clockwise seen from outside) with one UV per corner.
  const quad = (corners: number[][], normal: number[], cornerUvs: number[][]) => {
    const base = positions.length / 3
    corners.forEach((corner, index) => {
      positions.push(corner[0], corner[1], corner[2])
      normals.push(normal[0], normal[1], normal[2])
      uvs.push(cornerUvs[index][0], cornerUvs[index][1])
    })
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  // Texture v grows downward; geometry y grows upward.
  const px = (x: number) => x / size - 0.5
  const py = (y: number) => 0.5 - y / size
  quad(
    [
      [-0.5, -0.5, half],
      [0.5, -0.5, half],
      [0.5, 0.5, half],
      [-0.5, 0.5, half],
    ],
    [0, 0, 1],
    [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]
  )
  quad(
    [
      [0.5, -0.5, -half],
      [-0.5, -0.5, -half],
      [-0.5, 0.5, -half],
      [0.5, 0.5, -half],
    ],
    [0, 0, -1],
    [
      [1, 1],
      [0, 1],
      [0, 0],
      [1, 0],
    ]
  )
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!opaque(x, y)) continue
      // Every corner of a side samples this pixel's center.
      const uv = [(x + 0.5) / size, (y + 0.5) / size]
      const same = [uv, uv, uv, uv]
      const [left, right, top, bottom] = [px(x), px(x + 1), py(y), py(y + 1)]
      if (!opaque(x - 1, y))
        quad(
          [
            [left, bottom, -half],
            [left, bottom, half],
            [left, top, half],
            [left, top, -half],
          ],
          [-1, 0, 0],
          same
        )
      if (!opaque(x + 1, y))
        quad(
          [
            [right, bottom, half],
            [right, bottom, -half],
            [right, top, -half],
            [right, top, half],
          ],
          [1, 0, 0],
          same
        )
      if (!opaque(x, y - 1))
        quad(
          [
            [left, top, half],
            [right, top, half],
            [right, top, -half],
            [left, top, -half],
          ],
          [0, 1, 0],
          same
        )
      if (!opaque(x, y + 1))
        quad(
          [
            [left, bottom, -half],
            [right, bottom, -half],
            [right, bottom, half],
            [left, bottom, half],
          ],
          [0, -1, 0],
          same
        )
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

const geometryCache = new Map<string, Promise<THREE.BufferGeometry>>()
const extrudedGeometry = (src: string) => {
  let geometry = geometryCache.get(src)
  if (!geometry) {
    geometry = loadImage(src).then(extrude)
    geometryCache.set(src, geometry)
  }
  return geometry
}

const itemMaterial = (src: string, tint?: string | null) => {
  const material = new THREE.MeshLambertMaterial({
    map: textureFromUrl(src),
    alphaTest: 0.1,
    side: THREE.DoubleSide,
  })
  if (tint) material.color.set(tint)
  material.userData.baseColor = material.color.clone()
  material.userData.sharedMap = true
  return material
}

const unitCube = new THREE.BoxGeometry(1, 1, 1)

export type ItemMesh = {
  // A 1×1×1 item centered on the origin, filled in once its geometry is ready.
  object: THREE.Group
  // Whether it's a block (a cube) rather than a flat item.
  block: boolean
}

// null when there's no icon for the item.
export const buildItemMesh = (name: string): ItemMesh | null => {
  const icon = itemIcon(name)
  if (!icon) return null
  const object = new THREE.Group()
  if (icon.kind === 'cube') {
    // Faces are [top, north (left), west (right)]; BoxGeometry wants +x, -x, +y, -y, +z, -z.
    const [top, left, right] = icon.faces.map((face) => itemMaterial(face.src, face.tint))
    const mesh = new THREE.Mesh(unitCube, [right, right, top, top, left, left])
    mesh.userData.sharedGeometry = true
    mesh.castShadow = true
    object.add(mesh)
    return { object, block: true }
  }
  const material = itemMaterial(icon.src)
  extrudedGeometry(icon.src)
    .then((geometry) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.userData.sharedGeometry = true
      mesh.castShadow = true
      object.add(mesh)
    })
    .catch(() => {})
  return { object, block: false }
}
