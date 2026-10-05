// First person: zooming in past the closest orbit distance puts the camera in the bot's eyes. Clicking grabs
// the mouse (pointer lock) to look around like in game; Esc lets go of it, scrolling out (or F) leaves.
import * as THREE from 'three'

const EYE_HEIGHT = 1.62
const SNEAK_EYE_HEIGHT = 1.27
// Sneaking lowers the eyes over a few frames, like the game, instead of snapping (per second).
const EYE_EASE = 14
const LOOK_SPEED = 0.0024
const MAX_PITCH = Math.PI / 2 - 0.05
// Quake Pro, the game's widest field of view setting. The hand keeps the normal 70, as in the game.
export const FIRST_PERSON_FOV = 110
export const HAND_FOV = 70
// Sprinting widens the view. Use the bot's controls so sideways motion and packet
// timing cannot trigger a brief zoom that looks like moving forward and back.
const SPRINT_FOV = 1.15
// Scrolling out must add up to this much before it leaves, so one stray trackpad flick doesn't.
const LEAVE_SCROLL = 60
// Where the orbit camera lands when leaving: this far behind, a little above.
const LEAVE_DISTANCE = 6
const LEAVE_PITCH = -0.45
// OptiFine's zoom: holding C narrows the view to a quarter; the wheel (while held) zooms between these,
// a step at a time, and the view eases there at this rate (per second).
const ZOOM_DEFAULT = 4
const ZOOM_MIN = 1.5
const ZOOM_MAX = 16
const ZOOM_STEP = 1.2
const ZOOM_EASE = 14

export const createFirstPerson = (
  camera: THREE.PerspectiveCamera,
  element: HTMLElement,
  onChange: (state: { active: boolean; locked: boolean }) => void
) => {
  let active = false
  let yaw = 0
  let pitch = 0
  let scrolled = 0
  let eyeHeight = EYE_HEIGHT
  let zoomHeld = false
  let zoom = ZOOM_DEFAULT
  // The view without zoom, eased between normal and sprinting.
  let baseFov = FIRST_PERSON_FOV
  // Whether it had the mouse before a window (chat, inventory) took it, to grab it again after.
  let lockBeforePause = false
  const orbitFov = camera.fov
  const look = new THREE.Vector3()
  const aim = new THREE.Vector3()

  const direction = (target: THREE.Vector3, withPitch = pitch) =>
    target.set(-Math.sin(yaw) * Math.cos(withPitch), Math.sin(withPitch), -Math.cos(yaw) * Math.cos(withPitch))
  const locked = () => document.pointerLockElement === element
  const notify = () => onChange({ active, locked: locked() })

  const enter = (fromYaw: number) => {
    if (active) return
    active = true
    yaw = fromYaw
    pitch = 0
    scrolled = 0
    camera.fov = FIRST_PERSON_FOV
    eyeHeight = EYE_HEIGHT
    baseFov = FIRST_PERSON_FOV
    camera.updateProjectionMatrix()
    notify()
  }
  // Puts the orbit camera behind where first person was looking.
  const leave = (controls: { target: THREE.Vector3 }) => {
    if (!active) return
    active = false
    zoomHeld = false
    if (locked()) document.exitPointerLock()
    camera.fov = orbitFov
    camera.updateProjectionMatrix()
    camera.position.copy(controls.target).addScaledVector(direction(look, LEAVE_PITCH), -LEAVE_DISTANCE)
    camera.lookAt(controls.target)
    notify()
  }

  const handleMouseMove = (event: MouseEvent) => {
    if (!active || !locked()) return
    // Slower while zoomed, so aiming stays steady.
    const turn = LOOK_SPEED * Math.min(1, camera.fov / FIRST_PERSON_FOV)
    yaw -= event.movementX * turn
    pitch = THREE.MathUtils.clamp(pitch - event.movementY * turn, -MAX_PITCH, MAX_PITCH)
  }
  const typing = () => Boolean(document.activeElement?.closest('input, textarea, select, [contenteditable="true"]'))
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyC' || !active || event.repeat || event.ctrlKey || event.metaKey || typing()) return
    event.preventDefault()
    zoomHeld = true
    zoom = ZOOM_DEFAULT
  }
  const releaseZoom = (event?: KeyboardEvent) => {
    if (!event || event.code === 'KeyC') zoomHeld = false
  }
  const handleBlur = () => releaseZoom()
  ;(window as unknown as { __ryksuGrabPointer?: () => unknown }).__ryksuGrabPointer = () =>
    active ? Promise.resolve(element.requestPointerLock()).catch(() => {}) : undefined
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('pointerlockchange', notify)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', releaseZoom)
  window.addEventListener('blur', handleBlur)

  return {
    isActive: () => active,
    isLocked: locked,
    yaw: () => yaw,
    pitch: () => pitch,
    // A window opened (chat, inventory): give the mouse back; resume grabs it again if it had it.
    pause: () => {
      lockBeforePause = locked()
      if (lockBeforePause) document.exitPointerLock()
    },
    resume: () => {
      // Through the main process, which can grab it as a user gesture (closing chat with Esc isn't one).
      if (active && lockBeforePause && !locked()) void window.electronAPI.grabPointer().catch(() => {})
      lockBeforePause = false
    },
    enter,
    leave,
    lock: () => {
      if (active && !locked()) void Promise.resolve(element.requestPointerLock()).catch(() => {})
    },
    // Holding C (the zoom): the wheel zooms instead of changing the hotbar slot.
    isZooming: () => zoomHeld,
    // How far zoomed in, 0-1 (fully there by 2×), following the eased view: for lowering the hand.
    zoomAmount: () => THREE.MathUtils.clamp((baseFov - camera.fov) / (baseFov / 2), 0, 1),
    zoomScroll: (deltaY: number) => {
      if (deltaY === 0) return
      zoom = THREE.MathUtils.clamp(deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP, ZOOM_MIN, ZOOM_MAX)
    },
    // Wheel while in first person: true once scrolling out added up to leaving.
    scrollOut: (deltaY: number) => {
      scrolled = deltaY > 0 ? scrolled + deltaY : 0
      return scrolled >= LEAVE_SCROLL
    },
    // Moves the camera into the bot's eyes, looking where the mouse points.
    update: (feet: THREE.Vector3, crouching: boolean, delta: number, sprinting = false) => {
      const step = Math.min(delta, 0.1)
      const wantedBase = sprinting && !crouching ? FIRST_PERSON_FOV * SPRINT_FOV : FIRST_PERSON_FOV
      baseFov += (wantedBase - baseFov) * (1 - Math.exp(-step * 8))
      const fov = zoomHeld ? baseFov / zoom : baseFov
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov += (fov - camera.fov) * (1 - Math.exp(-step * ZOOM_EASE))
        camera.updateProjectionMatrix()
      }
      eyeHeight += ((crouching ? SNEAK_EYE_HEIGHT : EYE_HEIGHT) - eyeHeight) * (1 - Math.exp(-step * EYE_EASE))
      camera.position.copy(feet)
      camera.position.y += eyeHeight
      camera.lookAt(aim.copy(camera.position).add(direction(look)))
    },
    dispose: () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('pointerlockchange', notify)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', releaseZoom)
      window.removeEventListener('blur', handleBlur)
      if (locked()) document.exitPointerLock()
    },
  }
}
