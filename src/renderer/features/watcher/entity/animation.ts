// Moves a mob model like the game does: legs and arms swing while walking, the head turns to where the
// mob looks, arms sway at rest and swing on attack, wings flap, tails wag, a hit flashes red and death
// tips the mob over. Sitting and sneaking are held on top (postures.ts). Limbs are found by bone name and paired up by where they sit.
import * as THREE from 'three'
import type { MobModel } from './model'
import { createPostures } from './postures'
import { animateCape } from './cape'

type Limb = { bone: THREE.Group; rest: THREE.Euler; phase: number; side: number; front: boolean }

// Arms held straight out in front.
const RAISED_ARMS = new Set(['zombie', 'husk', 'drowned', 'zombie_villager'])
// Flap all the time, not just while moving.
const FLYERS = new Set(['bat', 'bee', 'phantom', 'vex', 'allay', 'parrot'])
const SWING_SECONDS = 0.3
const HURT_SECONDS = 0.4
const MAX_HEAD_TURN = THREE.MathUtils.degToRad(75)

const limb = (model: MobModel, name: string, phase: number): Limb => {
  const bone = model.bones.get(name)!
  const x = model.pivots.get(name)?.x ?? 0
  return { bone, rest: bone.rotation.clone(), phase, side: Math.sign(x), front: true }
}

const findRig = (model: MobModel) => {
  const names = [...model.bones.keys()]
  const legNames = names.filter((name) => /leg|foot|haunch/.test(name) && !/pants|armor/.test(name))
  const armNames = names.filter((name) => /arm/.test(name) && !/sleeve|armor|arms$/.test(name))
  // Quadrupeds move diagonal legs together; front legs are the ones further toward -z.
  const zs = legNames.map((name) => model.pivots.get(name)?.z ?? 0)
  const middleZ = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0
  const legs = legNames.map((name) => {
    const pivot = model.pivots.get(name)
    const side = Math.sign(pivot?.x ?? 0) || 1
    const front = (pivot?.z ?? 0) <= middleZ ? 1 : -1
    return { ...limb(model, name, side * front), front: front > 0 }
  })
  // Arms swing against the leg on their side.
  const arms = armNames.map((name) => limb(model, name, -(Math.sign(model.pivots.get(name)?.x ?? 0) || 1)))
  // A horse's head is its own root next to its neck, so turning it alone would tear it off.
  const headBone = model.bones.get('head')
  const head =
    headBone && !(model.boneData.get('head')?.parent === undefined && model.bones.has('neck'))
      ? limb(model, 'head', 0)
      : null
  if (head) head.bone.rotation.order = 'YXZ'
  const wings = names
    .filter((name) => /wing/.test(name) && !/tip/.test(name))
    .map((name) => limb(model, name, 0))
  const tails = names
    .filter(
      (name) => /^tail/.test(name) && !/^tail/.test(model.boneData.get(name)?.parent?.toLowerCase() ?? '')
    )
    .map((name) => limb(model, name, 0))
  return { legs, arms, head, wings, tails }
}

export type PoseInput = {
  // Seconds, from any steady clock.
  now: number
  // Walk cycle position and how much the mob is walking (0 standing, 1 full stride).
  stride: number
  walk: number
  // Seconds since the last frame.
  delta: number
  // Head turn relative to the body, and up/down look, in radians.
  headYaw: number
  pitch: number
  sitting: boolean
  crouching: boolean
}

export const createAnimator = (model: MobModel) => {
  const rig = findRig(model)
  const cape = model.bones.get('cape')
  const raised = RAISED_ARMS.has(model.type)
  const flyer = FLYERS.has(model.type)
  const postures = createPostures(model, rig.legs)
  let swingAt = -Infinity
  let hurtAt = -Infinity
  let deadAt: number | null = null
  let tinted = false

  const setTint = (on: boolean) => {
    if (on === tinted) return
    tinted = on
    for (const material of model.materials) {
      const base = material.userData.baseColor as THREE.Color | undefined
      if (!base) continue
      material.color.copy(base)
      if (on) material.color.multiply(new THREE.Color(1, 0.4, 0.4))
    }
  }

  const update = ({ now, stride, walk, delta, headYaw, pitch, sitting, crouching }: PoseInput) => {
    const swing = Math.sin(stride)
    for (const leg of rig.legs) {
      leg.bone.rotation.x = leg.rest.x + swing * 0.9 * walk * leg.phase
    }

    const swingProgress = (now - swingAt) / SWING_SECONDS
    const attack = swingProgress >= 0 && swingProgress < 1 ? Math.sin(swingProgress * Math.PI) : 0
    // The game's idle sway: arms drift slightly out and back.
    const sway = Math.cos(now * 1.8) * 0.05 + 0.05
    for (const arm of rig.arms) {
      const right = arm.side < 0
      arm.bone.rotation.x =
        arm.rest.x +
        (raised ? Math.PI / 2 : 0) +
        swing * (raised ? 0.15 : 0.8) * walk * arm.phase +
        Math.sin(now * 1.34) * 0.05 +
        (right || rig.arms.length === 1 ? attack * 1.3 : 0)
      arm.bone.rotation.z = arm.rest.z + arm.side * sway
    }

    // After the limbs, since poses add onto them.
    const pose = postures.update(delta, sitting, crouching)
    for (const arm of rig.arms) arm.bone.rotation.x += pose.armTilt

    if (rig.head) {
      rig.head.bone.rotation.y =
        rig.head.rest.y + THREE.MathUtils.clamp(headYaw, -MAX_HEAD_TURN, MAX_HEAD_TURN)
      rig.head.bone.rotation.x = rig.head.rest.x + THREE.MathUtils.clamp(pitch, -1.4, 1.4) + pose.headTilt
    }

    const flap = flyer ? Math.sin(now * 25) * 0.5 + 0.5 : (Math.sin(now * 18) * 0.5 + 0.5) * walk * 0.6
    for (const wing of rig.wings) {
      wing.bone.rotation.z = wing.rest.z + (wing.side || 1) * flap
    }
    for (const tail of rig.tails) {
      tail.bone.rotation.y = tail.rest.y + Math.sin(now * 7) * 0.3 * walk * (1 - pose.sitting)
    }

    if (cape?.children.length) animateCape(cape, now, stride, walk, delta)

    setTint(now - hurtAt < HURT_SECONDS || deadAt !== null)
    // Falls onto its side over about a second, like the game's death animation.
    model.root.rotation.z = deadAt === null ? 0 : Math.min(1, Math.sqrt((now - deadAt) * 1.6)) * (Math.PI / 2)
  }

  return {
    update,
    swing: (now: number) => (swingAt = now),
    hurt: (now: number) => (hurtAt = now),
    setDead: (now: number, dead: boolean) => {
      if (dead && deadAt === null) deadAt = now
      if (!dead) deadAt = null
    },
  }
}

export type Animator = ReturnType<typeof createAnimator>
