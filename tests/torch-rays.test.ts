import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { rayUniforms, updateTorchRayCasters } from '../src/components/watcher/torchRays'
import { boneGeometry } from '../src/utils/entity/geometry'

// Where a scene point lands in a caster box's own 0-1 cube.
const toBox = (box: number, point: THREE.Vector3) => {
  const rows = rayUniforms.uRayBoxes.value.slice(box * 3, box * 3 + 3)
  return rows.map((row) => row.x * point.x + row.y * point.y + row.z * point.z + row.w)
}
const near = (actual: number[], expected: number[]) =>
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-6, `${actual} vs ${expected}`))

test('a model cube becomes a shadow box that follows the entity', () => {
  // One 2×4×2 cube with its corner at the origin, in an entity standing at (10, 0, 5) turned 90°.
  const geometry = boneGeometry([{ origin: [0, 0, 0], size: [2, 4, 2], uv: [0, 0] }], new THREE.Vector3(), null, 1, 1)
  const entity = new THREE.Group()
  entity.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()))
  entity.position.set(10, 0, 5)
  entity.rotation.y = Math.PI / 2
  entity.updateMatrixWorld(true)

  updateTorchRayCasters(true, [entity], new THREE.Vector3())
  assert.equal(rayUniforms.uRayCasterCount.value, 1)
  assert.deepEqual(rayUniforms.uRayCasterBoxes.value[0].toArray(), [0, 1])
  // The cube's far corner, turned with the entity, is the box's (1, 1, 1).
  const far = new THREE.Vector3(2, 4, 2).applyMatrix4(entity.matrixWorld)
  near(toBox(0, far), [1, 1, 1])
  near(toBox(0, new THREE.Vector3(10, 0, 5)), [0, 0, 0])
  // The bounding sphere holds the whole cube.
  const sphere = rayUniforms.uRayCasters.value[0]
  assert.ok(new THREE.Vector3(sphere.x, sphere.y, sphere.z).distanceTo(far) <= sphere.w + 1e-6)

  updateTorchRayCasters(false, [entity], new THREE.Vector3())
  assert.equal(rayUniforms.uRayCasterCount.value, 0)
})

test('hidden parts and outline twins cast no shadow, but a hidden bot still does', () => {
  const geometry = boneGeometry([{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }], new THREE.Vector3(), null, 1, 1)
  const bot = new THREE.Group()
  const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  const hiddenPart = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  hiddenPart.visible = false
  const twin = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  twin.userData.silhouetteTwin = true
  body.add(twin)
  bot.add(body, hiddenPart)
  // First person hides the whole bot.
  bot.visible = false
  bot.updateMatrixWorld(true)
  updateTorchRayCasters(true, [bot], new THREE.Vector3())
  assert.equal(rayUniforms.uRayCasterBoxes.value[0].y, 1)
})
