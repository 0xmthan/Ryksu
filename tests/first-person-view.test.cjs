const test = require('node:test')
const assert = require('node:assert/strict')
const THREE = require('three')
const { createFirstPerson, FIRST_PERSON_FOV } = require('../src/components/watcher/firstPerson.ts')

test('alternating sideways movement keeps the view stable while actual sprint zoom still works', () => {
  const oldDocument = global.document
  const oldWindow = global.window
  global.document = { addEventListener() {}, removeEventListener() {}, pointerLockElement: null }
  global.window = { addEventListener() {}, removeEventListener() {} }
  const camera = new THREE.PerspectiveCamera()
  const view = createFirstPerson(camera, {}, () => {})
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
    global.document = oldDocument
    global.window = oldWindow
  }
})
