import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { boneGeometry } from '../src/utils/entity/geometry'
test('skin UVs stay inside each face while cube corners remain watertight', () => {
  const geometry = boneGeometry(
    [{ origin: [0, 0, 0], size: [8, 8, 8], uv: [0, 0] }],
    new THREE.Vector3(),
    null,
    1 / 64,
    1 / 64
  )
  const uv = geometry.getAttribute('uv')
  for (let index = 0; index < uv.count; index++) {
    for (const value of [uv.getX(index) * 64, uv.getY(index) * 64]) {
      assert.ok(Math.abs(value - Math.round(value)) > 0.009)
      assert.ok(Math.abs(value - Math.round(value)) < 0.011)
    }
  }
  const position = geometry.getAttribute('position')
  const corners = new Set()
  for (let index = 0; index < position.count; index++)
    corners.add([position.getX(index), position.getY(index), position.getZ(index)].join(','))
  assert.equal(corners.size, 8)
  geometry.dispose()
})
test('thin cape faces keep valid UV ranges after the seam inset', () => {
  const geometry = boneGeometry(
    [{ origin: [-5, -16, -1], size: [10, 16, 1], uv: [0, 0] }],
    new THREE.Vector3(),
    null,
    1 / 64,
    1 / 32
  )
  const uv = geometry.getAttribute('uv')
  for (let face = 0; face < 6; face++) {
    const us = Array.from({ length: 4 }, (_, i) => uv.getX(face * 4 + i))
    const vs = Array.from({ length: 4 }, (_, i) => uv.getY(face * 4 + i))
    assert.ok(Math.max(...us) > Math.min(...us))
    assert.ok(Math.max(...vs) > Math.min(...vs))
  }
  geometry.dispose()
})
