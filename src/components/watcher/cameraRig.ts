import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type CameraMode = 'overview' | 'follow'
const DISTANCES: Record<CameraMode, number> = { overview: 36, follow: 13 }
const POLAR: Record<CameraMode, number> = { overview: 0.85, follow: 1.12 }

// Move the camera and its orbit target together, retaining the angle and any deliberate pan.
export const createCameraRig = (camera: THREE.PerspectiveCamera, controls: OrbitControls) => {
  let mode: CameraMode = 'overview'
  let zoomTarget: number | null = null
  let polarTarget: number | null = null
  let centered = false
  let initialized = false
  const focus = new THREE.Vector3()
  const wanted = new THREE.Vector3()
  const shift = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const spherical = new THREE.Spherical()
  const distances = { ...DISTANCES }

  const recenter = () => {
    centered = true
    zoomTarget = distances[mode]
    polarTarget = POLAR[mode]
  }
  const setMode = (next: CameraMode) => {
    if (next === mode) return
    distances[mode] = camera.position.distanceTo(controls.target)
    mode = next
    recenter()
  }
  // An orbit or zoom gesture wins over automatic framing; F restores it when wanted.
  const onInteraction = () => {
    zoomTarget = null
    polarTarget = null
    centered = false
  }
  const onInteractionEnd = () => {
    distances[mode] = camera.position.distanceTo(controls.target)
  }
  controls.addEventListener('start', onInteraction)
  controls.addEventListener('end', onInteractionEnd)

  const update = (position: THREE.Vector3, delta: number) => {
    const ease = 1 - Math.exp(-Math.min(delta, 0.1) * 7)
    wanted.copy(position)
    wanted.y += 1.2
    if (!initialized) {
      initialized = true
      shift.copy(wanted).sub(controls.target)
      focus.copy(wanted)
      camera.position.add(shift)
      controls.target.copy(wanted)
    } else {
      shift.copy(focus)
      if (focus.distanceTo(wanted) > 12) focus.copy(wanted)
      else focus.lerp(wanted, ease)
      shift.subVectors(focus, shift)
      camera.position.add(shift)
      controls.target.add(shift)
    }
    if (centered) {
      shift.copy(focus).sub(controls.target).multiplyScalar(ease)
      camera.position.add(shift)
      controls.target.add(shift)
      if (controls.target.distanceToSquared(focus) < 0.0001) centered = false
    }
    if (zoomTarget !== null || polarTarget !== null) {
      offset.copy(camera.position).sub(controls.target)
      spherical.setFromVector3(offset)
      if (zoomTarget !== null) {
        spherical.radius = THREE.MathUtils.lerp(spherical.radius, zoomTarget, ease)
        if (Math.abs(spherical.radius - zoomTarget) < 0.01) zoomTarget = null
      }
      if (polarTarget !== null) {
        spherical.phi = THREE.MathUtils.lerp(spherical.phi, polarTarget, ease)
        if (Math.abs(spherical.phi - polarTarget) < 0.001) polarTarget = null
      }
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical))
    }
  }
  return {
    update,
    setMode,
    recenter,
    reanchor: (delta: THREE.Vector3) => {
      if (initialized) focus.add(delta)
    },
    dispose: () => {
      controls.removeEventListener('start', onInteraction)
      controls.removeEventListener('end', onInteractionEnd)
    },
  }
}
