// The bot's right arm in first person, posed and swung exactly like the game's empty hand (the vanilla
// first person arm transform), with the held item kept in the hand. Taken from a model built just for
// this, so it has the bot's own skin, sleeve and item. Drawn in its own little scene over the world (after
// a depth clear), so the arm never pokes into walls. Swings on a click, and keeps swinging while digging.
import * as THREE from 'three'
import type { MotionEntity } from '../../types'
import { buildEntityModel, lookOf } from '../../utils/entity/appearance'
import { disposeObject } from './sceneUtils'

// The game swings over 6 ticks.
const SWING_SECONDS = 0.3
// How far the arm drops when fully lowered (zoomed in), like the game's item switch dip but all the way.
const LOWER_DISTANCE = 1
// The right arm's pivot in the game's model space (pixels, y down).
const ARM_PIVOT = new THREE.Vector3(-5, 2, 0)
const DEGREES = Math.PI / 180

const translate = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z)
const rotateX = (degrees: number) => new THREE.Matrix4().makeRotationX(degrees * DEGREES)
const rotateY = (degrees: number) => new THREE.Matrix4().makeRotationY(degrees * DEGREES)
const rotateZ = (degrees: number) => new THREE.Matrix4().makeRotationZ(degrees * DEGREES)

// The game's first person right arm (ItemInHandRenderer.renderPlayerArm) at swing progress 0-1, in camera
// space, down to the arm's own model space in pixels.
const armMatrix = (swing: number) => {
  const root = Math.sqrt(swing)
  const pushX = -0.3 * Math.sin(root * Math.PI)
  const pushY = 0.4 * Math.sin(root * Math.PI * 2)
  const pushZ = -0.4 * Math.sin(swing * Math.PI)
  const turn = Math.sin(root * Math.PI)
  const tilt = Math.sin(swing * swing * Math.PI)
  return new THREE.Matrix4()
    .multiply(translate(pushX + 0.64000005, pushY - 0.6, pushZ - 0.71999997))
    .multiply(rotateY(45))
    .multiply(rotateY(turn * 70))
    .multiply(rotateZ(tilt * -20))
    .multiply(translate(-1, 3.6, 3.5))
    .multiply(rotateZ(120))
    .multiply(rotateX(200))
    .multiply(rotateY(-135))
    .multiply(translate(5.6, 0, 0))
    .multiply(translate(ARM_PIVOT.x / 16, ARM_PIVOT.y / 16, ARM_PIVOT.z / 16))
    .multiply(new THREE.Matrix4().makeScale(1 / 16, 1 / 16, 1 / 16))
}

export const createFirstPersonHand = (fov: number) => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 10)
  scene.add(new THREE.AmbientLight(0xffffff, 0.85), camera)
  const sun = new THREE.DirectionalLight(0xffffff, 0.6)
  sun.position.set(0.4, 1, 0.6)
  scene.add(sun)
  // In camera space; its matrix is the game's arm transform, set every frame.
  const holder = new THREE.Group()
  holder.matrixAutoUpdate = false
  camera.add(holder)

  let model: ReturnType<typeof buildEntityModel> = null
  let look = ''
  let swingStart = -Infinity
  let swingingUntilStopped = false

  const clearHolder = () => {
    for (const child of [...holder.children]) disposeObject(child)
  }

  // Rebuilt when the bot's skin, armor or held item changes.
  const setEntity = (entity: MotionEntity) => {
    const next = lookOf(entity)
    if (next === look) return
    look = next
    clearHolder()
    if (model) disposeObject(model.root)
    model = buildEntityModel(entity)
    const arm = model?.bones.get('rightarm')
    if (!model || !arm) return
    // Our models are y up; the game's model space is y down. The arm, its sleeve and armor and the held
    // item all go over together, so the item sits in the hand exactly as on the model.
    const flipped = new THREE.Group()
    flipped.scale.set(1, -1, 1)
    for (const child of [...arm.children]) flipped.add(child)
    holder.add(flipped)
  }

  return {
    setEntity,
    swing: (now: number) => {
      if (now - swingStart > SWING_SECONDS * 0.5) swingStart = now
    },
    // Digging swings over and over until it stops.
    setDigging: (digging: boolean) => {
      swingingUntilStopped = digging
    },
    // `lowered` 0-1 drops the arm out of view (while zoomed in), eased so it slides rather than slips.
    render: (renderer: THREE.WebGLRenderer, aspect: number, now: number, lowered = 0) => {
      if (lowered >= 1) return
      if (swingingUntilStopped && now - swingStart > SWING_SECONDS) swingStart = now
      const progress = THREE.MathUtils.clamp((now - swingStart) / SWING_SECONDS, 0, 1)
      const drop = THREE.MathUtils.smoothstep(lowered, 0, 1) * LOWER_DISTANCE
      holder.matrix.makeTranslation(0, -drop, 0).multiply(armMatrix(progress >= 1 ? 0 : progress))
      holder.matrixWorldNeedsUpdate = true
      if (camera.aspect !== aspect) {
        camera.aspect = aspect
        camera.updateProjectionMatrix()
      }
      const autoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.clearDepth()
      renderer.render(scene, camera)
      renderer.autoClear = autoClear
    },
    dispose: () => {
      clearHolder()
      if (model) disposeObject(model.root)
      model = null
    },
  }
}
