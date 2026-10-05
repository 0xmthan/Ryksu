import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// The camera is locked onto the bot: it orbits and zooms around it, but never drifts off. Nothing zooms or
// tilts on its own; F (recenter) eases back to this default view.
export const DEFAULT_DISTANCE = 18
const DEFAULT_POLAR = 0.95
// Follows the bot this snugly (per second); a big jump (respawn, teleport) snaps instead.
const FOLLOW_RATE = 9
const SNAP_DISTANCE = 12

export const createCameraRig = (camera: THREE.PerspectiveCamera, controls: OrbitControls) => {
  let zoomTarget: number | null = null
  let polarTarget: number | null = null
  let initialized = false
  const focus = new THREE.Vector3()
  const wanted = new THREE.Vector3()
  const shift = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const spherical = new THREE.Spherical()

  const recenter = () => {
    zoomTarget = DEFAULT_DISTANCE
    polarTarget = DEFAULT_POLAR
  }
  // An orbit or zoom gesture wins over an eased reset still under way.
  const onInteraction = () => {
    zoomTarget = null
    polarTarget = null
  }
  controls.addEventListener('start', onInteraction)

  const update = (position: THREE.Vector3, delta: number) => {
    const ease = 1 - Math.exp(-Math.min(delta, 0.1) * FOLLOW_RATE)
    wanted.copy(position)
    wanted.y += 1.2
    if (!initialized) {
      initialized = true
      focus.copy(wanted)
    } else if (focus.distanceTo(wanted) > SNAP_DISTANCE) {
      focus.copy(wanted)
    } else {
      focus.lerp(wanted, ease)
    }
    // Move the camera with its target, so the angle and zoom stay as they are.
    shift.subVectors(focus, controls.target)
    camera.position.add(shift)
    controls.target.copy(focus)

    if (zoomTarget !== null || polarTarget !== null) {
      const settle = 1 - Math.exp(-Math.min(delta, 0.1) * 7)
      offset.copy(camera.position).sub(controls.target)
      spherical.setFromVector3(offset)
      if (zoomTarget !== null) {
        spherical.radius = THREE.MathUtils.lerp(spherical.radius, zoomTarget, settle)
        if (Math.abs(spherical.radius - zoomTarget) < 0.01) zoomTarget = null
      }
      if (polarTarget !== null) {
        spherical.phi = THREE.MathUtils.lerp(spherical.phi, polarTarget, settle)
        if (Math.abs(spherical.phi - polarTarget) < 0.001) polarTarget = null
      }
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical))
    }
  }
  return {
    update,
    recenter,
    reanchor: (delta: THREE.Vector3) => {
      if (initialized) focus.add(delta)
    },
    dispose: () => {
      controls.removeEventListener('start', onInteraction)
    },
  }
}
