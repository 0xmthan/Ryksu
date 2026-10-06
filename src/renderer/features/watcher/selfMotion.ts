import * as THREE from 'three'

const TICK_SECONDS = 0.05
const STALE_SECONDS = 0.3
const TELEPORT_DISTANCE = 8

// Follow received physics positions over one tick. Reversing input never projects the
// camera ahead along the old velocity or jumps it to a new prediction.
export const createSelfMotion = () => {
  const start = new THREE.Vector3()
  const target = new THREE.Vector3()
  const incoming = new THREE.Vector3()
  let at = -Infinity
  const sample = (now: number, output: THREE.Vector3) =>
    output.copy(start).lerp(target, THREE.MathUtils.clamp((now - at) / TICK_SECONDS, 0, 1))
  return {
    fresh: (now: number) => now - at < STALE_SECONDS,
    sample,
    receive: (position: { x: number; y: number; z: number }, now: number) => {
      incoming.set(position.x, position.y, position.z)
      if (now - at >= STALE_SECONDS || incoming.distanceTo(target) > TELEPORT_DISTANCE) {
        start.copy(incoming)
      } else {
        sample(now, start)
      }
      target.copy(incoming)
      at = now
    },
  }
}
