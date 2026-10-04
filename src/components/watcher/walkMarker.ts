// A pulsing square on the ground where the bot was told to walk, fading once the walk is over: it got
// there, stopped short on purpose (at a door), or gave up.
import * as THREE from 'three'

const COLOR = '#38bdf8'
const ARRIVED_DISTANCE = 1.2
const MAX_SECONDS = 20
// A walk that hasn't started by now isn't going to (unreachable, or already there).
const START_SECONDS = 2
const FADE_SECONDS = 0.4

export const createWalkMarker = (scene: THREE.Scene) => {
  const square = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2)),
    new THREE.LineBasicMaterial({ color: COLOR, transparent: true, depthTest: false })
  )
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.25, depthWrite: false })
  )
  const marker = new THREE.Group()
  marker.add(fill, square)
  marker.renderOrder = 3
  marker.visible = false
  scene.add(marker)

  let shownAt = 0
  let fadingFrom: number | null = null
  let started = false

  return {
    // `position` is the block the bot should stand in, in scene coordinates.
    show: (position: THREE.Vector3, now: number) => {
      marker.position.set(position.x + 0.5, position.y + 0.02, position.z + 0.5)
      marker.visible = true
      shownAt = now
      fadingFrom = null
      started = false
    },
    // `walking`: whether the bot still has somewhere to go.
    update: (now: number, bot: THREE.Vector3 | null, walking: boolean) => {
      if (!marker.visible) return
      if (walking) started = true
      const arrived =
        bot && Math.hypot(bot.x - marker.position.x, bot.z - marker.position.z) < ARRIVED_DISTANCE
      const over = (started && !walking) || (!started && now - shownAt > START_SECONDS)
      if (fadingFrom === null && (arrived || over || now - shownAt > MAX_SECONDS)) fadingFrom = now
      const fade = fadingFrom === null ? 1 : 1 - (now - fadingFrom) / FADE_SECONDS
      if (fade <= 0) {
        marker.visible = false
        return
      }
      const pulse = 1 + Math.sin((now - shownAt) * 6) * 0.08
      marker.scale.set(pulse, 1, pulse)
      ;(square.material as THREE.LineBasicMaterial).opacity = fade
      ;(fill.material as THREE.MeshBasicMaterial).opacity = 0.25 * fade
    },
    // Scene coordinates shift when the view re-anchors far from the origin.
    shift: (offset: THREE.Vector3) => marker.position.add(offset),
  }
}
