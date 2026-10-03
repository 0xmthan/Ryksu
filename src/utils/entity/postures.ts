// Whole-body poses held on top of the walk animation: four-legged pets sitting and players sneaking.
import * as THREE from 'three'
import type { MobModel } from './model'

export type Leg = { bone: THREE.Group; front: boolean }

// How long a pose takes to settle, in seconds.
const BLEND_SECONDS = 0.15

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

// Sitting tips the body back about the hips until the front legs, held straight down, just reach the
// ground, with the hind legs folded forward flat underneath. Null for mobs without four-ish legs.
const sitShape = (model: MobModel, legs: Leg[]) => {
  const pivot = (leg: Leg) => model.pivots.get(leg.bone.name.toLowerCase())!
  const back = legs.filter((leg) => !leg.front)
  const front = legs.filter((leg) => leg.front)
  if (back.length < 2 || front.length < 2) return null
  const hipY = average(back.map((leg) => pivot(leg).y))
  const hipZ = average(back.map((leg) => pivot(leg).z))
  const shoulderY = average(front.map((leg) => pivot(leg).y))
  const reach = hipZ - average(front.map((leg) => pivot(leg).z))
  // Folded hind legs rest about a pixel above the ground.
  const drop = hipY - 1
  let angle = 0
  for (let degrees = 0; degrees <= 70; degrees++) {
    const radians = THREE.MathUtils.degToRad(degrees)
    const raised = 1 + (shoulderY - hipY) * Math.cos(radians) + reach * Math.sin(radians)
    angle = radians
    if (raised >= shoulderY) break
  }
  // Turning the frame about the hips (in pixels) is a turn about its origin plus this shift.
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const offset = new THREE.Vector3(
    0,
    hipY - (hipY * cos - hipZ * sin) - drop,
    hipZ - (hipY * sin + hipZ * cos)
  )
  return { angle, offset, back, front }
}

// Sneaking leans the upper body forward and draws the legs back, as the game's player model does. Null
// for anything without a separate body bone.
const crouchShape = (model: MobModel) => {
  const body = model.bones.get('body')
  if (!body) return null
  const legs = ['rightleg', 'leftleg']
    .map((name) => model.bones.get(name))
    .filter((bone): bone is THREE.Group => Boolean(bone) && bone!.parent !== body)
  return { body, bodyY: body.position.y, legs, legZ: legs.map((leg) => leg.position.z) }
}

export const createPostures = (model: MobModel, legs: Leg[]) => {
  const sit = sitShape(model, legs)
  const crouch = crouchShape(model)
  let sitAmount = 0
  let crouchAmount = 0

  // Eases toward the wanted poses; returns how far in each one is, for the animator's own limbs.
  const update = (delta: number, sitting: boolean, crouching: boolean) => {
    const step = Math.min(1, delta / BLEND_SECONDS)
    sitAmount += ((sitting && sit ? 1 : 0) - sitAmount) * step
    crouchAmount += ((crouching && crouch ? 1 : 0) - crouchAmount) * step

    if (sit) {
      model.frame.rotation.x = sit.angle * sitAmount
      model.frame.position.copy(sit.offset).multiplyScalar(sitAmount / 16)
      for (const leg of sit.back) leg.bone.rotation.x += (Math.PI / 2 - sit.angle) * sitAmount
      for (const leg of sit.front) leg.bone.rotation.x += -sit.angle * sitAmount
    }
    if (crouch) {
      crouch.body.rotation.x = -0.5 * crouchAmount
      crouch.body.position.y = crouch.bodyY - 3.2 * crouchAmount
      crouch.legs.forEach((leg, index) => (leg.position.z = crouch.legZ[index] + 4 * crouchAmount))
    }
    return {
      // Undoes the body's tilt on the head, so it keeps looking where the mob looks.
      headTilt: -(sit ? sit.angle * sitAmount : 0) + 0.5 * crouchAmount,
      // Arms hang from the leaning body; the game holds them a little forward of straight down.
      armTilt: 0.9 * crouchAmount,
      sitting: sitAmount,
    }
  }
  return { update }
}
