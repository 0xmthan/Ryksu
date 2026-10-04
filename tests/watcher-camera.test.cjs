const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const THREE = require('three')
const exportsObject = {}
const source = fs.readFileSync(path.join(__dirname, '../src/components/watcher/cameraRig.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText
vm.runInNewContext(compiled, { exports: exportsObject, require })

function setup() {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(16, 22, 24)
  const controls = new THREE.EventDispatcher()
  controls.target = new THREE.Vector3(0, 1.2, 0)
  const rig = exportsObject.createCameraRig(camera, controls)
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

test('follow view eases in and preserves the horizontal camera angle', () => {
  const { camera, controls, rig } = setup()
  const initialDistance = camera.position.distanceTo(controls.target)
  const initialAngle = Math.atan2(camera.position.x, camera.position.z)
  rig.setMode('follow')
  rig.update(new THREE.Vector3(), 1 / 60)
  const nextDistance = camera.position.distanceTo(controls.target)
  assert.ok(nextDistance > 13 && nextDistance < initialDistance)
  for (let i = 0; i < 120; i++) rig.update(new THREE.Vector3(), 1 / 60)
  assert.ok(Math.abs(camera.position.distanceTo(controls.target) - 13) < 0.02)
  assert.ok(Math.abs(Math.atan2(camera.position.x, camera.position.z) - initialAngle) < 0.00001)
  rig.dispose()
})

test('manual camera gestures interrupt automatic zoom', () => {
  const { camera, controls, rig } = setup()
  rig.setMode('follow')
  controls.dispatchEvent({ type: 'start' })
  const distance = camera.position.distanceTo(controls.target)
  rig.update(new THREE.Vector3(), 1 / 60)
  assert.equal(camera.position.distanceTo(controls.target), distance)
  rig.dispose()
})

test('recenter smoothly removes a deliberate pan', () => {
  const { camera, controls, rig } = setup()
  camera.position.x += 10
  controls.target.x += 10
  rig.recenter()
  rig.update(new THREE.Vector3(), 1 / 60)
  assert.ok(controls.target.x > 0 && controls.target.x < 10)
  for (let i = 0; i < 120; i++) rig.update(new THREE.Vector3(), 1 / 60)
  assert.ok(Math.abs(controls.target.x) < 0.02)
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
