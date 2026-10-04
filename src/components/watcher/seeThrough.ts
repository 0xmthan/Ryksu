// Keeps the bot in sight through whatever stands between it and the camera (tree canopies, walls, hills):
// whole blocks that cover it from where the camera is right now are drawn as a faint hologram instead of
// solid. Two shapes to pick from (H cycles them): `cone`, the blocks covering the bot and a margin around
// it, and `wall`, a wide slab of everything between the camera and the bot, so a whole building front goes
// see-through. The same block geometry goes into two materials: the solid one drops those blocks, the hologram one
// draws only them. Only blocks at or above the bot's feet and in front of it count, so the floor it stands
// on and what's behind it stay solid.
import * as THREE from 'three'

// The cone from the camera that covers the bot: its radius at the bot (blocks), aimed this high above the feet.
const BOT_RADIUS = 4
// At the bot's feet the cone is this narrow, widening to BOT_RADIUS over GROW_HEIGHT blocks up: bumps,
// bushes and logs on the ground only turn see-through when they really cover the bot, while walls and
// canopies get the wide opening.
const LOW_RADIUS = 1
const GROW_HEIGHT = 2
const AIM_HEIGHT = 0.9
// How far a block's center may be outside the cone and still cut into it.
const BLOCK_SLACK = 0.6
// Blocks centered within this distance of the bot (along the line) are beside it, not in front of it.
const KEEP_NEAR = 0.8
// Block centers must be this far toward the camera from the bot, on the ground plane: a wall behind the bot
// (or blocks above and behind its head, which the slanted line passes in front of) stays solid.
const FRONT_MARGIN = 0.5
// Block centers must be this far above the feet: the block the bot stands on stays solid.
const FLOOR_MARGIN = 0.1
// The wall shape: half its width across the view (blocks).
const WALL_HALF_WIDTH = 7
export const HOLOGRAM_OPACITY = 0.22

const uniforms = {
  uSeeCamera: { value: new THREE.Vector3() },
  uSeeTarget: { value: new THREE.Vector3() },
  uSeeFloor: { value: 0 },
  uSeeStrength: { value: 0 },
  uSeeWall: { value: 0 },
}

export type SeeThroughShape = 'cone' | 'wall' | 'off'
export const SEE_THROUGH_SHAPES: SeeThroughShape[] = ['cone', 'wall', 'off']
let shape: SeeThroughShape = 'cone'
export const setSeeThroughShape = (next: SeeThroughShape) => {
  shape = next
  uniforms.uSeeWall.value = next === 'wall' ? 1 : 0
}
export const getSeeThroughShape = () => shape

const f = (value: number) => value.toFixed(3)
const VERTEX_HEAD = `
attribute vec3 cell;
varying float vSeeHidden;
uniform vec3 uSeeCamera;
uniform vec3 uSeeTarget;
uniform float uSeeFloor;
uniform float uSeeStrength;
uniform float uSeeWall;
float seeHidden(vec3 center) {
  if (center.y < uSeeFloor) return 0.0;
  vec2 level = uSeeTarget.xz - uSeeCamera.xz;
  float reach = max(length(level), 0.0001);
  vec2 forward = level / reach;
  if (uSeeWall > 0.5) {
    vec2 rel = center.xz - uSeeTarget.xz;
    float depth = dot(rel, forward);
    float side = abs(rel.x * forward.y - rel.y * forward.x);
    return step(-reach, depth) * step(depth, -${f(KEEP_NEAR)}) * step(side, ${f(WALL_HALF_WIDTH)}) * uSeeStrength;
  }
  if (dot(center.xz - uSeeTarget.xz, forward) > -${f(FRONT_MARGIN)}) return 0.0;
  vec3 ray = uSeeTarget - uSeeCamera;
  float len = max(length(ray), 0.0001);
  vec3 dir = ray / len;
  float along = dot(center - uSeeCamera, dir);
  if (along < 0.0 || along > len - ${f(KEEP_NEAR)}) return 0.0;
  float off = length(center - (uSeeCamera + dir * along));
  float tall = clamp((center.y - uSeeFloor - 0.4) / ${f(GROW_HEIGHT)}, 0.0, 1.0);
  float radius = mix(${f(LOW_RADIUS)}, ${f(BOT_RADIUS)}, tall);
  return step(off, radius * along / len + ${f(BLOCK_SLACK)}) * uSeeStrength;
}
`
const VERTEX_BODY = '\n  vSeeHidden = seeHidden((modelMatrix * vec4(cell + 0.5, 1.0)).xyz);'
// A cap's cell is the block above it: it shows only while that block is a hologram and its own block isn't,
// so a wall gone see-through gets a floor at its foot, not one on every layer.
const CAP_BODY =
  '\n  vec3 seeAbove = (modelMatrix * vec4(cell + 0.5, 1.0)).xyz;' +
  '\n  vSeeHidden = seeHidden(seeAbove) * (1.0 - seeHidden(seeAbove - vec3(0.0, 1.0, 0.0)));'

// Same test on the CPU, so clicks pass through blocks shown as a hologram.
const ray = new THREE.Vector3()
const closest = new THREE.Vector3()
const center = new THREE.Vector3()
const hiddenAt = (cell: THREE.Vector3) => {
  const { uSeeCamera, uSeeTarget, uSeeFloor, uSeeStrength } = uniforms
  center.copy(cell).addScalar(0.5)
  if (uSeeStrength.value <= 0 || center.y < uSeeFloor.value) return false
  if (shape === 'wall') {
    const target = uSeeTarget.value
    const forwardX = target.x - uSeeCamera.value.x
    const forwardZ = target.z - uSeeCamera.value.z
    const reach = Math.max(Math.hypot(forwardX, forwardZ), 0.0001)
    const relX = center.x - target.x
    const relZ = center.z - target.z
    const depth = (relX * forwardX + relZ * forwardZ) / reach
    const side = Math.abs(relX * forwardZ - relZ * forwardX) / reach
    return depth >= -reach && depth <= -KEEP_NEAR && side <= WALL_HALF_WIDTH
  }
  {
    const forwardX = uSeeTarget.value.x - uSeeCamera.value.x
    const forwardZ = uSeeTarget.value.z - uSeeCamera.value.z
    const reach = Math.max(Math.hypot(forwardX, forwardZ), 0.0001)
    const depth = ((center.x - uSeeTarget.value.x) * forwardX + (center.z - uSeeTarget.value.z) * forwardZ) / reach
    if (depth > -FRONT_MARGIN) return false
  }
  ray.subVectors(uSeeTarget.value, uSeeCamera.value)
  const len = Math.max(ray.length(), 0.0001)
  ray.divideScalar(len)
  const along = closest.subVectors(center, uSeeCamera.value).dot(ray)
  if (along < 0 || along > len - KEEP_NEAR) return false
  closest.copy(uSeeCamera.value).addScaledVector(ray, along)
  const tall = THREE.MathUtils.clamp((center.y - uSeeFloor.value - 0.4) / GROW_HEIGHT, 0, 1)
  const radius = THREE.MathUtils.lerp(LOW_RADIUS, BOT_RADIUS, tall)
  return center.distanceTo(closest) <= (radius * along) / len + BLOCK_SLACK
}

// `solid` drops the blocks covering the bot; `hologram` draws only those; `cap` draws the tops of solid
// blocks under them.
export const applySeeThrough = (material: THREE.Material, role: 'solid' | 'hologram' | 'cap') => {
  const test = role === 'solid' ? 'vSeeHidden > 0.5' : 'vSeeHidden < 0.5'
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader =
      VERTEX_HEAD +
      shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>${role === 'cap' ? CAP_BODY : VERTEX_BODY}`)
    shader.fragmentShader =
      'varying float vSeeHidden;\n' +
      shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n  if (${test}) discard;`
      )
  }
  material.customProgramCacheKey = () => `see-through-${role}`
  material.needsUpdate = true
}

// Aims the cone at the bot (feet position, scene coordinates), or turns it off with null.
export const updateSeeThrough = (camera: THREE.Camera, feet: THREE.Vector3 | null) => {
  uniforms.uSeeStrength.value = feet && shape !== 'off' ? 1 : 0
  if (!feet) return
  uniforms.uSeeCamera.value.copy(camera.position)
  uniforms.uSeeTarget.value.copy(feet).setY(feet.y + AIM_HEIGHT)
  uniforms.uSeeFloor.value = feet.y + FLOOR_MARGIN
}

// Whether the block at this cell (scene coordinates) is shown as a hologram, so picking looks past it.
export const isSeeThrough = (cell: THREE.Vector3) => hiddenAt(cell)
