// Geometry for Bedrock-style cubes (as in prismarine-viewer's Entity.js, MIT): each cube becomes a box with
// its faces cut from the texture by the standard box UV layout.
import * as THREE from 'three'
import type { Cube } from './data'

// Which texture rows/columns each face of a cube box uses, in multiples of the box size (Entity.js).
const FACES = [
  {
    dir: [0, 1, 0],
    u0: [0, 0, 1],
    v0: [0, 0, 0],
    u1: [1, 0, 1],
    v1: [0, 0, 1],
    corners: [
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0],
      [0, 1, 0, 0, 1],
      [1, 1, 0, 1, 1],
    ],
  },
  {
    dir: [0, -1, 0],
    u0: [1, 0, 1],
    v0: [0, 0, 0],
    u1: [2, 0, 1],
    v1: [0, 0, 1],
    corners: [
      [1, 0, 1, 0, 0],
      [0, 0, 1, 1, 0],
      [1, 0, 0, 0, 1],
      [0, 0, 0, 1, 1],
    ],
  },
  {
    dir: [1, 0, 0],
    u0: [0, 0, 0],
    v0: [0, 0, 1],
    u1: [0, 0, 1],
    v1: [0, 1, 1],
    corners: [
      [1, 1, 1, 0, 0],
      [1, 0, 1, 0, 1],
      [1, 1, 0, 1, 0],
      [1, 0, 0, 1, 1],
    ],
  },
  {
    dir: [-1, 0, 0],
    u0: [1, 0, 1],
    v0: [0, 0, 1],
    u1: [1, 0, 2],
    v1: [0, 1, 1],
    corners: [
      [0, 1, 0, 0, 0],
      [0, 0, 0, 0, 1],
      [0, 1, 1, 1, 0],
      [0, 0, 1, 1, 1],
    ],
  },
  {
    dir: [0, 0, -1],
    u0: [0, 0, 1],
    v0: [0, 0, 1],
    u1: [1, 0, 1],
    v1: [0, 1, 1],
    corners: [
      [1, 0, 0, 0, 1],
      [0, 0, 0, 1, 1],
      [1, 1, 0, 0, 0],
      [0, 1, 0, 1, 0],
    ],
  },
  {
    dir: [0, 0, 1],
    u0: [1, 0, 2],
    v0: [0, 0, 1],
    u1: [2, 0, 2],
    v1: [0, 1, 1],
    corners: [
      [0, 0, 1, 0, 1],
      [1, 0, 1, 1, 1],
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0],
    ],
  },
]

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const toEuler = (degrees: number[]) =>
  new THREE.Euler(
    THREE.MathUtils.degToRad(-degrees[0]),
    THREE.MathUtils.degToRad(-degrees[1]),
    THREE.MathUtils.degToRad(-degrees[2])
  )

// Geometry for one bone's cubes, relative to the bone's pivot. The bone's own rotation is baked in
// here (as Entity.js does), since in this format it turns only its cubes, not its child bones.
export const boneGeometry = (
  cubes: Cube[],
  pivot: THREE.Vector3,
  boneRotation: THREE.Euler | null,
  uScale: number,
  vScale: number
) => {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const point = new THREE.Vector3()
  for (const cube of cubes) {
    const inflate = cube.inflate ?? 0
    const cubeRotation = cube.rotation ? toEuler(cube.rotation) : null
    const cubePivot = new THREE.Vector3(...(cube.pivot ?? [0, 0, 0]))
    for (const { dir, corners, u0, v0, u1, v1 } of FACES) {
      const base = positions.length / 3
      // Keep nearest-neighbor samples inside this face's atlas rectangle.
      // A tiny inset avoids neighboring (often white) texels at cube seams
      // without trimming half a pixel from Minecraft's small face textures.
      const uStart = dot(u0, cube.size), uEnd = dot(u1, cube.size)
      const vStart = dot(v0, cube.size), vEnd = dot(v1, cube.size)
      const uInset = Math.sign(uEnd - uStart) * Math.min(0.01, Math.abs(uEnd - uStart) / 2)
      const vInset = Math.sign(vEnd - vStart) * Math.min(0.01, Math.abs(vEnd - vStart) / 2)
      for (const corner of corners) {
        point.set(
          cube.origin[0] + corner[0] * cube.size[0] + (corner[0] ? inflate : -inflate),
          cube.origin[1] + corner[1] * cube.size[1] + (corner[1] ? inflate : -inflate),
          cube.origin[2] + corner[2] * cube.size[2] + (corner[2] ? inflate : -inflate)
        )
        if (cubeRotation) {
          point.sub(cubePivot).applyEuler(cubeRotation).add(cubePivot)
        }
        point.sub(pivot)
        if (boneRotation) {
          point.applyEuler(boneRotation)
        }
        positions.push(point.x, point.y, point.z)
        normals.push(dir[0], dir[1], dir[2])
        uvs.push(
          (cube.uv[0] + (corner[3] ? uEnd - uInset : uStart + uInset)) * uScale,
          (cube.uv[1] + (corner[4] ? vEnd - vInset : vStart + vInset)) * vScale
        )
      }
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}
