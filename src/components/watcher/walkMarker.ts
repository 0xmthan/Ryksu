// A pulsing square on the ground where the bot was told to walk, fading once it gets there (or after a
// while, if it can't).
import * as THREE from 'three'

const COLOR = '#38bdf8'
const ARRIVED_DISTANCE = 1.2
const MAX_SECONDS = 20
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

  return {
    // `position` is the block the bot should stand in, in scene coordinates.
    show: (position: THREE.Vector3, now: number) => {
      marker.position.set(position.x + 0.5, position.y + 0.02, position.z + 0.5)
      marker.visible = true
      shownAt = now
      fadingFrom = null
    },
    update: (now: number, bot: THREE.Vector3 | null) => {
      if (!marker.visible) return
      const arrived =
        bot && Math.hypot(bot.x - marker.position.x, bot.z - marker.position.z) < ARRIVED_DISTANCE
      if (fadingFrom === null && (arrived || now - shownAt > MAX_SECONDS)) fadingFrom = now
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
