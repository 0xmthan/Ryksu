import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createCameraRig, DEFAULT_DISTANCE } from '../src/components/watcher/cameraRig'

// Just what the rig uses of the orbit controls: the point they circle and their start/end events.
type FakeControls = THREE.EventDispatcher<{ start: object; end: object; change: object }> & {
  target: THREE.Vector3
}

function setup() {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(16, 22, 24)
  const controls = Object.assign(new THREE.EventDispatcher(), {
    target: new THREE.Vector3(0, 1.2, 0),
  }) as FakeControls
  const rig = createCameraRig(camera, controls as unknown as OrbitControls)
  rig.update(new THREE.Vector3(), 1 / 60)
  return { camera, controls, rig }
}

test('camera follows smoothly while keeping its orbit offset', () => {
  const { camera, controls, rig } = setup()
  const offset = camera.position.clone().sub(controls.target)
  rig.update(new THREE.Vector3(4, 0, 0), 1 / 60)
  assert.ok(controls.target.x > 0 && controls.target.x < 4)
  assert.ok(camera.position.clone().sub(controls.target).distanceTo(offset) < 0.00001)
  rig.dispose()
})

test('the camera stays locked on the bot, so a pan never sticks', () => {
  const { camera, controls, rig } = setup()
  camera.position.x += 10
  controls.target.x += 10
  for (let i = 0; i < 120; i++) rig.update(new THREE.Vector3(), 1 / 60)
  assert.ok(Math.abs(controls.target.x) < 0.00001)
  rig.dispose()
})

test('recenter eases to the default view and keeps the horizontal angle', () => {
  const { camera, controls, rig } = setup()
  const initialAngle = Math.atan2(camera.position.x, camera.position.z)
  rig.recenter()
  for (let i = 0; i < 180; i++) rig.update(new THREE.Vector3(), 1 / 60)
  assert.ok(Math.abs(camera.position.distanceTo(controls.target) - DEFAULT_DISTANCE) < 0.02)
  assert.ok(Math.abs(Math.atan2(camera.position.x, camera.position.z) - initialAngle) < 0.00001)
  rig.dispose()
})

test('manual camera gestures interrupt an eased reset', () => {
  const { camera, controls, rig } = setup()
  rig.recenter()
  controls.dispatchEvent({ type: 'start' })
  const distance = camera.position.distanceTo(controls.target)
  rig.update(new THREE.Vector3(), 1 / 60)
  assert.ok(Math.abs(camera.position.distanceTo(controls.target) - distance) < 0.00001)
  rig.dispose()
})

test('reanchoring does not shift the camera a second time', () => {
  const { camera, controls, rig } = setup()
  const shift = new THREE.Vector3(-3000, 0, 0)
  camera.position.add(shift)
  controls.target.add(shift)
  rig.reanchor(shift)
  const expected = camera.position.clone()
  rig.update(shift, 1 / 60)
  assert.ok(camera.position.distanceTo(expected) < 0.00001)
  rig.dispose()
})
