// Ray-cast torch light (experimental): instead of the light spread block by block, which bends around
// corners, each surface near a torch (lantern, glowstone, …) casts a ray to it through the block grid, so
// solid blocks throw real shadows. The grid is the light payload's (255 = solid) as a 3D texture; the
// nearest point lights to the bot go in as uniforms. The bot, mobs and players near it cast shadows too:
// each model cube goes in as a box (MAX_BOXES in all), grouped by entity under a bounding sphere so a ray
// only tests the boxes of entities it passes near. Lava, fire and lights past the nearest MAX_LIGHTS keep
// the spread light (see rayBlockLight below).
import * as THREE from 'three'
import type { BlockView } from '../../types'

type Blocks = BlockView

const MAX_LIGHTS = 32
const MAX_CASTERS = 12
const MAX_BOXES = 64
// The most cells a ray crosses: a light reaches 15 blocks, so at most 15 steps on each axis.
const MAX_STEPS = 48

const uniforms = {
  uRayVoxels: { value: null as THREE.Data3DTexture | null },
  uRayVoxelMin: { value: new THREE.Vector3() },
  uRayVoxelSize: { value: new THREE.Vector3(1, 1, 1) },
  uRayLights: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
  uRayLightCount: { value: 0 },
  uRayStrength: { value: 0 },
  // Per entity: bounding sphere (center, radius) and its boxes (first, count).
  uRayCasters: { value: Array.from({ length: MAX_CASTERS }, () => new THREE.Vector4()) },
  uRayCasterBoxes: { value: Array.from({ length: MAX_CASTERS }, () => new THREE.Vector2()) },
  uRayCasterCount: { value: 0 },
  // Per box, three rows of the matrix taking scene coordinates into the box's own 0-1 cube.
  uRayBoxes: { value: Array.from({ length: MAX_BOXES * 3 }, () => new THREE.Vector4()) },
}

export const VERTEX_HEAD = 'varying vec3 vRayWorld;\nvarying vec3 vRayNormal;'
export const VERTEX_BODY = '\n  vRayWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vRayNormal = normal;'

// rayBlockLight(spread): the block light (0-1) for this fragment, given the spread light it would get.
export const FRAGMENT_HEAD = `
varying vec3 vRayWorld;
varying vec3 vRayNormal;
uniform highp sampler3D uRayVoxels;
uniform vec3 uRayVoxelMin;
uniform vec3 uRayVoxelSize;
uniform vec4 uRayLights[${MAX_LIGHTS}];
uniform int uRayLightCount;
uniform float uRayStrength;
uniform vec4 uRayCasters[${MAX_CASTERS}];
uniform vec2 uRayCasterBoxes[${MAX_CASTERS}];
uniform int uRayCasterCount;
uniform vec4 uRayBoxes[${MAX_BOXES * 3}];

bool raySolid(ivec3 cell) {
  if (any(lessThan(cell, ivec3(0))) || any(greaterThanEqual(cell, ivec3(uRayVoxelSize)))) return false;
  // Laid out x, z, y like the payload's light cells.
  return texelFetch(uRayVoxels, ivec3(cell.x, cell.z, cell.y), 0).r > 0.99;
}

// Whether the line from a to b (grid units) crosses a solid cell, walking the cells it passes through.
bool rayBlocked(vec3 a, vec3 b) {
  vec3 dir = b - a;
  ivec3 cell = ivec3(floor(a));
  ivec3 target = ivec3(floor(b));
  ivec3 stepDir = ivec3(sign(dir));
  vec3 delta = 1.0 / max(abs(dir), vec3(1e-6));
  vec3 next = vec3(
    stepDir.x > 0 ? (float(cell.x) + 1.0 - a.x) * delta.x : stepDir.x < 0 ? (a.x - float(cell.x)) * delta.x : 2.0,
    stepDir.y > 0 ? (float(cell.y) + 1.0 - a.y) * delta.y : stepDir.y < 0 ? (a.y - float(cell.y)) * delta.y : 2.0,
    stepDir.z > 0 ? (float(cell.z) + 1.0 - a.z) * delta.z : stepDir.z < 0 ? (a.z - float(cell.z)) * delta.z : 2.0
  );
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (cell == target) return false;
    if (next.x < next.y && next.x < next.z) {
      if (next.x > 1.0) return false;
      cell.x += stepDir.x;
      next.x += delta.x;
    } else if (next.y < next.z) {
      if (next.y > 1.0) return false;
      cell.y += stepDir.y;
      next.y += delta.y;
    } else {
      if (next.z > 1.0) return false;
      cell.z += stepDir.z;
      next.z += delta.z;
    }
    if (cell != target && raySolid(cell)) return true;
  }
  return false;
}

// Whether the segment a-b (scene coordinates) passes through one of the boxes.
bool segmentHitsBox(vec3 a, vec3 b, int box) {
  vec4 r0 = uRayBoxes[box * 3];
  vec4 r1 = uRayBoxes[box * 3 + 1];
  vec4 r2 = uRayBoxes[box * 3 + 2];
  vec3 la = vec3(dot(r0.xyz, a) + r0.w, dot(r1.xyz, a) + r1.w, dot(r2.xyz, a) + r2.w);
  vec3 lb = vec3(dot(r0.xyz, b) + r0.w, dot(r1.xyz, b) + r1.w, dot(r2.xyz, b) + r2.w);
  vec3 d = lb - la;
  d = mix(d, vec3(1e-6), lessThan(abs(d), vec3(1e-6)));
  vec3 t0 = -la / d;
  vec3 t1 = (1.0 - la) / d;
  vec3 near = min(t0, t1);
  vec3 far = max(t0, t1);
  return max(max(near.x, near.y), max(near.z, 0.0)) <= min(min(far.x, far.y), min(far.z, 1.0));
}

// Whether an entity (the bot, a mob, a player) stands between a and b.
bool entityBlocked(vec3 a, vec3 b) {
  vec3 ab = b - a;
  float length2 = max(dot(ab, ab), 1e-6);
  for (int i = 0; i < ${MAX_CASTERS}; i++) {
    if (i >= uRayCasterCount) break;
    vec4 sphere = uRayCasters[i];
    vec3 closest = a + ab * clamp(dot(sphere.xyz - a, ab) / length2, 0.0, 1.0);
    if (distance(closest, sphere.xyz) > sphere.w) continue;
    int first = int(uRayCasterBoxes[i].x);
    int count = int(uRayCasterBoxes[i].y);
    for (int box = 0; box < ${MAX_BOXES}; box++) {
      if (box >= count) break;
      if (segmentHitsBox(a, b, first + box)) return true;
    }
  }
  return false;
}

float rayBlockLight(float spread) {
  if (uRayStrength < 0.5) return spread;
  vec3 normal = normalize(vRayNormal);
  // Where the spread light was sampled (half a block out from the face), so the two compare.
  vec3 sampleAt = vRayWorld + normal * 0.5;
  vec3 start = vRayWorld + normal * 0.02 - uRayVoxelMin;
  // open: what the lights would give with nothing in the way; lit: what reaches this point.
  float open = 0.0;
  float lit = 0.0;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uRayLightCount) break;
    vec4 light = uRayLights[i];
    // The game's falloff: one level less per block.
    float level = (light.w - distance(sampleAt, light.xyz)) / 15.0;
    if (level <= 0.0) continue;
    open = max(open, level);
    if (level <= lit || dot(light.xyz - vRayWorld, normal) <= 0.0) continue;
    vec3 from = vRayWorld + normal * 0.02;
    if (!entityBlocked(from, light.xyz) && !rayBlocked(start, light.xyz - uRayVoxelMin)) lit = level;
  }
  // The spread light above what these lights explain comes from others (lava, far torches): kept as is.
  return max(lit, spread - open);
}
`

export const rayUniforms = uniforms

let emitters: number[] = []
let offset = new THREE.Vector3()
let radius = 0
let below = 0

// A new block payload: the grid as a 3D texture, and its lights. `blockOffset` places the payload's origin
// in the scene (like the chunk meshes).
export const updateTorchRayBlocks = (blocks: Blocks, blockOffset: THREE.Vector3) => {
  const { width, height, cells } = blocks.light
  let texture = uniforms.uRayVoxels.value
  const image = texture?.image as { width: number; height: number; depth: number } | undefined
  if (!texture || image?.width !== width || image.height !== width || image.depth !== height) {
    texture?.dispose()
    texture = new THREE.Data3DTexture(new Uint8Array(cells), width, width, height)
    texture.format = THREE.RedFormat
    texture.type = THREE.UnsignedByteType
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    texture.unpackAlignment = 1
    uniforms.uRayVoxels.value = texture
  } else {
    ;(texture.image as { data: Uint8Array }).data.set(cells)
  }
  texture.needsUpdate = true
  radius = (width - 1) / 2
  below = blocks.light.below
  offset = blockOffset.clone()
  uniforms.uRayVoxelMin.value.set(offset.x - radius, offset.y - below, offset.z - radius)
  uniforms.uRayVoxelSize.value.set(width, height, width)
  emitters = blocks.emitters ?? []
}

const order: number[] = []
// Each few frames: the lights nearest the bot (scene coordinates), and whether the effect is on.
export const updateTorchRayLights = (enabled: boolean, focus: THREE.Vector3) => {
  uniforms.uRayStrength.value = enabled ? 1 : 0
  if (!enabled) return
  const count = emitters.length / 4
  order.length = 0
  for (let i = 0; i < count; i++) order.push(i)
  const distance = (i: number) =>
    (offset.x + emitters[i * 4] + 0.5 - focus.x) ** 2 +
    (offset.y + emitters[i * 4 + 1] + 0.5 - focus.y) ** 2 +
    (offset.z + emitters[i * 4 + 2] + 0.5 - focus.z) ** 2
  if (count > MAX_LIGHTS) order.sort((a, b) => distance(a) - distance(b))
  const used = Math.min(count, MAX_LIGHTS)
  for (let n = 0; n < used; n++) {
    const i = order[n]
    uniforms.uRayLights.value[n].set(
      offset.x + emitters[i * 4] + 0.5,
      offset.y + emitters[i * 4 + 1] + 0.5,
      offset.z + emitters[i * 4 + 2] + 0.5,
      emitters[i * 4 + 3]
    )
  }
  uniforms.uRayLightCount.value = used
}

// The boxes of one mesh in its own space: the cubes recorded when the model was built (entity/geometry.ts),
// or else its bounding box (held items, simple shapes).
const framesOf = (mesh: THREE.Mesh): number[] => {
  const geometry = mesh.geometry
  if (geometry.userData.cubeFrames) return geometry.userData.cubeFrames
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const size = box.getSize(new THREE.Vector3())
  geometry.userData.cubeFrames = [...box.min.toArray(), size.x, 0, 0, 0, size.y, 0, 0, 0, size.z]
  return geometry.userData.cubeFrames
}

const frame = new THREE.Matrix4()
const world = new THREE.Matrix4()
const edges = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const corner = new THREE.Vector3()
const center = new THREE.Vector3()
const boxCenters: THREE.Vector3[] = Array.from({ length: MAX_BOXES }, () => new THREE.Vector3())
const boxReach: number[] = []
const casterOrder: THREE.Object3D[] = []

// Meshes under `root` that draw: hidden parts skipped, but not a hidden root (the bot in first person still
// casts its shadow), nor the outline twins (silhouette.ts).
const eachMesh = (root: THREE.Object3D, visit: (mesh: THREE.Mesh) => void) => {
  const walk = (object: THREE.Object3D) => {
    for (const child of object.children) {
      if (!child.visible || child.userData.silhouetteTwin) continue
      if ((child as THREE.Mesh).isMesh) visit(child as THREE.Mesh)
      walk(child)
    }
  }
  walk(root)
}

// Each frame while on: the entities nearest `focus` (scene coordinates) as shadow casters.
export const updateTorchRayCasters = (enabled: boolean, entities: THREE.Object3D[], focus: THREE.Vector3) => {
  if (!enabled) {
    uniforms.uRayCasterCount.value = 0
    return
  }
  casterOrder.length = 0
  casterOrder.push(...entities)
  casterOrder.sort((a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus))
  let boxes = 0
  let casters = 0
  for (const entity of casterOrder) {
    if (casters >= MAX_CASTERS || boxes >= MAX_BOXES) break
    const first = boxes
    eachMesh(entity, (mesh) => {
      const frames = framesOf(mesh)
      for (let i = 0; i + 11 < frames.length && boxes < MAX_BOXES; i += 12) {
        corner.fromArray(frames, i)
        edges[0].fromArray(frames, i + 3)
        edges[1].fromArray(frames, i + 6)
        edges[2].fromArray(frames, i + 9)
        // Flat parts (ears, wings, a cape) get a sliver of thickness so the box can be inverted.
        const longest = Math.max(edges[0].length(), edges[1].length(), edges[2].length(), 1e-3)
        for (let axis = 0; axis < 3; axis++) {
          if (edges[axis].length() > longest * 0.01) continue
          const other = edges[(axis + 1) % 3].clone().cross(edges[(axis + 2) % 3])
          if (other.lengthSq() < 1e-12) other.set(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
          edges[axis].copy(other.normalize().multiplyScalar(longest * 0.02))
          corner.addScaledVector(edges[axis], -0.5)
        }
        frame.makeBasis(edges[0], edges[1], edges[2]).setPosition(corner)
        world.multiplyMatrices(mesh.matrixWorld, frame)
        const e = world.elements
        // The box's center and how far its corners reach from it, for the entity's bounding sphere.
        boxCenters[boxes].set(e[12] + (e[0] + e[4] + e[8]) / 2, e[13] + (e[1] + e[5] + e[9]) / 2, e[14] + (e[2] + e[6] + e[10]) / 2)
        boxReach[boxes] = (Math.hypot(e[0], e[1], e[2]) + Math.hypot(e[4], e[5], e[6]) + Math.hypot(e[8], e[9], e[10])) / 2
        world.invert()
        const inverse = world.elements
        uniforms.uRayBoxes.value[boxes * 3].set(inverse[0], inverse[4], inverse[8], inverse[12])
        uniforms.uRayBoxes.value[boxes * 3 + 1].set(inverse[1], inverse[5], inverse[9], inverse[13])
        uniforms.uRayBoxes.value[boxes * 3 + 2].set(inverse[2], inverse[6], inverse[10], inverse[14])
        boxes++
      }
    })
    const count = boxes - first
    if (!count) continue
    center.set(0, 0, 0)
    for (let i = first; i < boxes; i++) center.add(boxCenters[i])
    center.divideScalar(count)
    let radius = 0
    for (let i = first; i < boxes; i++) radius = Math.max(radius, center.distanceTo(boxCenters[i]) + boxReach[i])
    uniforms.uRayCasters.value[casters].set(center.x, center.y, center.z, radius)
    uniforms.uRayCasterBoxes.value[casters].set(first, count)
    casters++
  }
  uniforms.uRayCasterCount.value = casters
}
