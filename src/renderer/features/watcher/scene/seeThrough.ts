// Keeps the bot in sight under tree canopies, roofs and overhangs: blocks above the bot's head that stand
// between the camera and the bot are cut away (not drawn at all), so there is no ghostly hologram to look
// through. Everything at the bot's own level (trunks, walls, hills) stays solid; the bot and players show
// through those as an outline instead (see silhouette.ts). H cycles through the cutaway with the ghosted roofs
// and cut cave ceilings, the cutaway alone, and nothing see-through.
import * as THREE from 'three'

// Blocks whose centers are this far above the feet can be cut: the two layers the bot stands in stay.
const HEAD_CLEARANCE = 2
// The cone from the camera to the bot: its radius at the bot (blocks), aimed this high above the feet.
const CUT_RADIUS = 5
const AIM_HEIGHT = 0.9
// How far a block's center may be outside the cone and still cut into it.
const BLOCK_SLACK = 0.6

const uniforms = {
  uSeeCamera: { value: new THREE.Vector3() },
  uSeeTarget: { value: new THREE.Vector3() },
  uSeeFloor: { value: 0 },
  uSeeStrength: { value: 0 },
}

// all: the cutaway plus the ghosted roofs and cut cave ceilings (viewMode.ts); cutaway: the cutaway alone.
export type SeeThroughShape = 'all' | 'cutaway' | 'off'
export const SEE_THROUGH_SHAPES: SeeThroughShape[] = ['all', 'cutaway', 'off']
let shape: SeeThroughShape = 'all'
export const setSeeThroughShape = (next: SeeThroughShape) => {
  shape = next
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
float seeHidden(vec3 center) {
  if (center.y < uSeeFloor) return 0.0;
  vec3 ray = uSeeTarget - uSeeCamera;
  float len = max(length(ray), 0.0001);
  vec3 dir = ray / len;
  float along = dot(center - uSeeCamera, dir);
  if (along < 0.0 || along > len) return 0.0;
  float off = length(center - (uSeeCamera + dir * along));
  return step(off, ${f(CUT_RADIUS)} * along / len + ${f(BLOCK_SLACK)}) * uSeeStrength;
}
`
const VERTEX_BODY = '\n  vSeeHidden = seeHidden((modelMatrix * vec4(cell + 0.5, 1.0)).xyz);'
// A cap's cell is the block above it: it shows only while that block is cut and its own block isn't, so
// the cut has a floor (the tops of the blocks under it) instead of open holes.
const CAP_BODY =
  '\n  vec3 seeAbove = (modelMatrix * vec4(cell + 0.5, 1.0)).xyz;' +
  '\n  vSeeHidden = seeHidden(seeAbove) * (1.0 - seeHidden(seeAbove - vec3(0.0, 1.0, 0.0)));'

// Same test on the CPU, so clicks pass through cut blocks.
const ray = new THREE.Vector3()
const closest = new THREE.Vector3()
const center = new THREE.Vector3()
const hiddenAt = (cell: THREE.Vector3) => {
  const { uSeeCamera, uSeeTarget, uSeeFloor, uSeeStrength } = uniforms
  center.copy(cell).addScalar(0.5)
  if (uSeeStrength.value <= 0 || center.y < uSeeFloor.value) return false
  ray.subVectors(uSeeTarget.value, uSeeCamera.value)
  const len = Math.max(ray.length(), 0.0001)
  ray.divideScalar(len)
  const along = closest.subVectors(center, uSeeCamera.value).dot(ray)
  if (along < 0 || along > len) return false
  closest.copy(uSeeCamera.value).addScaledVector(ray, along)
  return center.distanceTo(closest) <= (CUT_RADIUS * along) / len + BLOCK_SLACK
}

// `solid` drops the cut blocks; `cap` draws the tops of the blocks under them.
export const applySeeThrough = (material: THREE.Material, role: 'solid' | 'cap') => {
  const test = role === 'solid' ? 'vSeeHidden > 0.5' : 'vSeeHidden < 0.5'
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader =
      VERTEX_HEAD +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>${role === 'cap' ? CAP_BODY : VERTEX_BODY}`
      )
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
  uniforms.uSeeFloor.value = feet.y + HEAD_CLEARANCE
}

// Whether the block at this cell (scene coordinates) is cut away, so picking looks past it.
export const isSeeThrough = (cell: THREE.Vector3) => hiddenAt(cell)
