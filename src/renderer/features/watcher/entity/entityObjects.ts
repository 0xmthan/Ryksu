// The bot, mobs, players and dropped items in the watcher: built from motion updates, then glided toward
// each new position and animated every frame.
import * as THREE from 'three'
import type { EntityKind, MotionEntity } from '../../../../shared/types'
import { createAnimator, type Animator } from './animation'
import { buildEntityModel, lookOf } from './appearance'
import { buildItemMesh } from './itemMesh'
import type { MobModel } from './model'
import { disposeObject, shortestAngle } from '../sceneUtils'
import { createPlayerNametag, type PlayerNametag } from './playerNametag'

export const ENTITY_COLORS: Record<EntityKind, string> = {
  player: '#38bdf8',
  hostile: '#ef4444',
  passive: '#facc15',
  item: '#e5e5e5',
}

const ENTITY_SIZES: Record<EntityKind, [number, number, number]> = {
  player: [0.6, 1.8, 0.6],
  hostile: [0.6, 1.8, 0.6],
  passive: [0.9, 0.9, 0.9],
  item: [0.3, 0.3, 0.3],
}

// Further than this in one update is a teleport, so jump instead of gliding.
export const SNAP_DISTANCE = 8
// Lying in bed, the feet sit this far toward the bed's foot from where the game puts the sleeper (the
// head block), as the game's renderer shifts them.
const SLEEP_SHIFT = 1.52

// Dropped items are this big (blocks a bit smaller, like the game).
const ITEM_SIZE = 0.35
const BLOCK_ITEM_SIZE = 0.25

export type Tracked = {
  object: THREE.Object3D
  nametag: PlayerNametag | null
  target: THREE.Vector3
  yaw: number
  headYaw: number
  pitch: number
  shownHeadYaw: number
  shownPitch: number
  sitting: boolean
  crouching: boolean
  // The bed's yaw while asleep, and how far into lying down the model is (0-1).
  sleeping: number | null
  lying: number
  model: MobModel | null
  animator: Animator | null
  // Dropped items spin and bob.
  spinner: THREE.Object3D | null
  stride: number
  walk: number
  // The last swing and hurt counts seen, to spot new ones.
  swing: number
  hurt: number
  look: string
}

const droppedItem = (name: string) => {
  const item = buildItemMesh(name)
  if (!item) return null
  item.object.scale.setScalar(item.block ? BLOCK_ITEM_SIZE : ITEM_SIZE)
  const spinner = new THREE.Group()
  spinner.add(item.object)
  return spinner
}

// Something without a model (or a mob newer than the generated ones): a colored box.
const placeholder = (kind: EntityKind) => {
  const [width, height, depth] = ENTITY_SIZES[kind]
  const geometry = new THREE.BoxGeometry(width, height, depth)
  geometry.translate(0, height / 2, 0)
  return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: ENTITY_COLORS[kind] }))
}

// Builds the entity, taking over position, facing and walk cycle from the one it replaces (when its look
// changed) so it doesn't jump.
export const createTracked = (
  entity: MotionEntity,
  target: THREE.Vector3,
  previous: Tracked | undefined,
  options: { bot?: boolean } = {}
): Tracked => {
  const object = new THREE.Group()
  object.userData.name = options.bot ? 'Bot' : (entity.item ?? entity.name)
  // For picking it out with the mouse; the bot is never a target.
  if (!options.bot) object.userData.entityId = entity.id
  const model = buildEntityModel(entity)
  const spinner = !model && entity.kind === 'item' && entity.item ? droppedItem(entity.item) : null
  object.add(model?.root ?? spinner ?? placeholder(entity.kind))
  const nametag = entity.kind === 'player' && !options.bot ? createPlayerNametag(entity) : null
  if (nametag) object.add(nametag.sprite)

  object.position.copy(previous ? previous.object.position : target)
  object.rotation.y = previous ? previous.object.rotation.y : entity.yaw
  if (previous) disposeObject(previous.object)
  return {
    object,
    nametag,
    target,
    yaw: entity.yaw,
    headYaw: entity.headYaw,
    pitch: entity.pitch,
    shownHeadYaw: previous?.shownHeadYaw ?? entity.headYaw,
    shownPitch: previous?.shownPitch ?? entity.pitch,
    sitting: Boolean(entity.sitting),
    crouching: Boolean(entity.crouching),
    sleeping: entity.sleeping ?? null,
    lying: previous?.lying ?? 0,
    model,
    animator: model ? createAnimator(model) : null,
    spinner,
    stride: previous?.stride ?? 0,
    walk: previous?.walk ?? 0,
    swing: entity.swing,
    hurt: entity.hurt,
    look: lookOf(entity),
  }
}

// Takes in a motion update; returns false when the look changed and the entity needs rebuilding.
export const syncTracked = (entry: Tracked, entity: MotionEntity, target: THREE.Vector3, now: number) => {
  if (entry.look !== lookOf(entity)) return false
  entry.nametag?.update(entity)
  entry.target.copy(target)
  entry.yaw = entity.yaw
  entry.headYaw = entity.headYaw
  entry.pitch = entity.pitch
  entry.sitting = Boolean(entity.sitting)
  entry.crouching = Boolean(entity.crouching)
  entry.sleeping = entity.sleeping ?? null
  if (entity.swing > entry.swing) entry.animator?.swing(now)
  if (entity.hurt > entry.hurt) entry.animator?.hurt(now)
  entry.swing = entity.swing
  entry.hurt = entity.hurt
  entry.animator?.setDead(now, Boolean(entity.dead))
  return true
}

const before = new THREE.Vector3()

// Moves an entity toward its latest position and animates it by how far it went.
export const stepTracked = (entry: Tracked, blend: number, delta: number, now: number) => {
  const { object, target } = entry
  before.copy(object.position)
  if (object.position.distanceTo(target) > SNAP_DISTANCE) {
    object.position.copy(target)
  } else {
    object.position.lerp(target, blend)
  }
  // The head leads a gentler body turn; both take the shortest route across the yaw wrap.
  const bodyBlend = 1 - Math.exp(-delta * 7)
  const headBlend = 1 - Math.exp(-delta * 10)
  // Asleep, it turns at once to lie along the bed, head toward the headboard.
  const asleep = entry.sleeping !== null
  const yaw = asleep ? entry.sleeping! + Math.PI : entry.yaw
  object.rotation.y += shortestAngle(object.rotation.y, yaw) * (asleep ? 1 : bodyBlend)
  entry.lying += ((asleep ? 1 : 0) - entry.lying) * Math.min(1, delta / 0.15)
  if (entry.model) {
    // On its back: the model's up turns to point at the headboard and its face to the sky.
    entry.model.root.rotation.x = (Math.PI / 2) * entry.lying
    entry.model.root.position.z = -SLEEP_SHIFT * entry.lying
  }
  entry.shownHeadYaw += shortestAngle(entry.shownHeadYaw, entry.headYaw) * headBlend
  entry.shownPitch += (entry.pitch - entry.shownPitch) * headBlend

  if (entry.spinner) {
    entry.spinner.rotation.y = now * 1.5
    entry.spinner.position.y = 0.2 + Math.sin(now * 2.5) * 0.05
  }
  if (entry.animator) {
    const moved = Math.hypot(object.position.x - before.x, object.position.z - before.z)
    const speed = delta > 0 && moved < SNAP_DISTANCE ? moved / delta : 0
    entry.stride += moved < SNAP_DISTANCE ? moved * 3 : 0
    entry.walk += (Math.min(1, speed / 3) - entry.walk) * blend
    entry.animator.update({
      now,
      stride: entry.stride,
      walk: entry.walk * (1 - entry.lying),
      delta,
      sitting: entry.sitting,
      crouching: entry.crouching,
      headYaw: asleep ? 0 : shortestAngle(object.rotation.y, entry.shownHeadYaw),
      pitch: asleep ? 0 : entry.shownPitch,
    })
  }
}
