const test = require('node:test')
const assert = require('node:assert/strict')
const THREE = require('three')
const { createSelfMotion } = require('../src/components/watcher/selfMotion.ts')

test('sideways starts and rapid reversals stay continuous without overshooting', () => {
  const motion = createSelfMotion()
  const sample = new THREE.Vector3()
  motion.receive({ x: 0, y: 64, z: 0 }, 0)
  motion.receive({ x: 0.2, y: 64, z: 0 }, 0.05)
  assert.equal(motion.sample(0.05, sample).x, 0)
  assert.ok(Math.abs(motion.sample(0.075, sample).x - 0.1) < 1e-8)
  let now = 0.075
  for (const x of [-0.2, 0.2, -0.2, 0.2]) {
    const before = motion.sample(now, sample).x
    motion.receive({ x, y: 64, z: 0 }, now)
    assert.equal(motion.sample(now, sample).x, before)
    const halfway = motion.sample(now + 0.025, sample).x
    assert.ok(halfway >= Math.min(before, x) && halfway <= Math.max(before, x))
    assert.equal(sample.y, 64)
    now += 0.025
  }
  assert.equal(motion.sample(now + 1, sample).x, 0.2)
})

test('teleports and stale streams reset instead of sliding across the world', () => {
  const motion = createSelfMotion()
  const sample = new THREE.Vector3()
  assert.equal(motion.fresh(0), false)
  motion.receive({ x: 0, y: 0, z: 0 }, 0)
  motion.receive({ x: 100, y: 0, z: 0 }, 0.05)
  assert.equal(motion.sample(0.05, sample).x, 100)
  assert.equal(motion.fresh(0.5), false)
  motion.receive({ x: 101, y: 0, z: 0 }, 0.5)
  assert.equal(motion.sample(0.5, sample).x, 101)
})
