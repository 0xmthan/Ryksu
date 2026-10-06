import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createFirstPerson, FIRST_PERSON_FOV } from '../src/components/watcher/firstPerson'
import { fake } from './fakes'

test('alternating sideways movement keeps the view stable while actual sprint zoom still works', () => {
  const oldDocument = globalThis.document
  const oldWindow = globalThis.window
  globalThis.document = fake<Document>({ addEventListener() {}, removeEventListener() {}, pointerLockElement: null })
  globalThis.window = fake<Window & typeof globalThis>({ addEventListener() {}, removeEventListener() {} })
  const camera = new THREE.PerspectiveCamera()
  const view = createFirstPerson(camera, fake<HTMLElement>({}), () => {})
  try {
    view.enter(0)
    for (let frame = 0; frame < 120; frame++) {
      const feet = new THREE.Vector3(frame % 2 ? 0.25 : -0.25, 64, 10)
      view.update(feet, false, 1 / 60, false)
      assert.equal(camera.fov, FIRST_PERSON_FOV)
      assert.equal(camera.position.z, 10)
      assert.equal(camera.position.x, feet.x)
    }
    for (let frame = 0; frame < 60; frame++) view.update(new THREE.Vector3(), false, 1 / 60, true)
    assert.ok(camera.fov > FIRST_PERSON_FOV)
    for (let frame = 0; frame < 120; frame++) view.update(new THREE.Vector3(), false, 1 / 60, false)
    assert.ok(Math.abs(camera.fov - FIRST_PERSON_FOV) < 0.03)
  } finally {
    view.dispose()
    globalThis.document = oldDocument
    globalThis.window = oldWindow
  }
})
