// Worn armor and held items on mob and player models.
import * as THREE from 'three'
import type { EquipmentSlot, WornItem } from '../../types'
import type { Bone } from './data'
import { entityData } from './data'
import { buildItemMesh } from './itemMesh'
import { addLayer, mobMaterial, textureSize, type MobModel } from './model'
import { loadTexture } from './textures'
import { buildHeldShield } from './shield'

type Equipment = Partial<Record<EquipmentSlot, WornItem>>

// Leather armor's undyed color.
const LEATHER = '#a06540'
// Item name prefix → armor texture name.
const MATERIALS: Record<string, string> = {
  leather: 'leather',
  chainmail: 'chainmail',
  iron: 'iron',
  copper: 'copper',
  golden: 'gold',
  diamond: 'diamond',
  netherite: 'netherite',
}

// Which bones each armor piece covers, with the box UV in the 64×32 armor texture and how far it sits
// out from the body (the game's armor model inflates the body boxes).
const PIECES: Record<
  'head' | 'chest' | 'legs' | 'feet',
  { suffix: string; layer: 'humanoid' | 'humanoid_leggings'; parts: [string, number[], number][] }
> = {
  head: { suffix: 'helmet', layer: 'humanoid', parts: [['head', [0, 0], 1]] },
  chest: {
    suffix: 'chestplate',
    layer: 'humanoid',
    parts: [
      ['body', [16, 16], 1],
      ['rightarm', [40, 16], 1],
      ['leftarm', [40, 16], 1],
    ],
  },
  legs: {
    suffix: 'leggings',
    layer: 'humanoid_leggings',
    parts: [
      ['body', [16, 16], 0.5],
      ['rightleg', [0, 16], 0.5],
      ['leftleg', [0, 16], 0.5],
    ],
  },
  feet: {
    suffix: 'boots',
    layer: 'humanoid',
    parts: [
      ['rightleg', [0, 16], 1],
      ['leftleg', [0, 16], 1],
    ],
  },
}

const armorMaterial = (name: string, suffix: string) => {
  if (name === 'turtle_helmet') return 'turtle_scute'
  const match = name.match(new RegExp(`^(.+)_${suffix}$`))
  return match ? MATERIALS[match[1]] : undefined
}

// Armor boxes copy the bone's first box (its unscaled body part), so they fit any humanoid.
const armorBones = (model: MobModel, parts: [string, number[], number][], extra = 0): Bone[] =>
  parts.flatMap(([name, uv, inflate]) => {
    const bone = model.boneData.get(name)
    const cube = bone?.cubes?.[0]
    if (!bone || !cube) return []
    // Armor sleeves retain the standard four-pixel arm and atlas layout on
    // Alex skins. Copying a three-pixel skin arm shifts the sleeve face UVs.
    const armorCube = /^(left|right)arm$/.test(name) && cube.size[0] === 3
      ? { ...cube, size: [4, cube.size[1], cube.size[2]],
          origin: [cube.origin[0] - (name === 'rightarm' ? 1 : 0), cube.origin[1], cube.origin[2]] }
      : cube
    return [
      {
        name: bone.name,
        pivot: bone.pivot,
        cubes: [{ origin: armorCube.origin, size: armorCube.size, uv, inflate: inflate + extra }],
      },
    ]
  })

const addArmorPiece = (model: MobModel, slot: keyof typeof PIECES, item: WornItem) => {
  const piece = PIECES[slot]
  const material = armorMaterial(item.name, piece.suffix)
  const baby = Boolean(model.entry && model.entry === entityData.entities[model.type]?.baby)
  const textures = entityData.armor[baby ? 'humanoid_baby' : piece.layer]
  const texture = material ? textures[material] : undefined
  if (texture === undefined) return false
  const size = textureSize(texture)
  const leather = material === 'leather'
  const babyUvs: Record<string, number[]> = slot === 'chest'
    ? { body: [0, 17], rightarm: [30, 25], leftarm: [30, 17] }
    : slot === 'legs' ? { body: [0, 33], rightleg: [18, 17], leftleg: [18, 24] }
    : slot === 'feet' ? { rightleg: [0, 25], leftleg: [0, 29] } : { head: [0, 0] }
  const bones = (extra = 0) => {
    const result = armorBones(model, baby
      ? piece.parts.map(([name]) => [name, babyUvs[name], slot === 'feet' ? 0.5 : 0.3])
      : piece.parts, extra)
    if (baby && slot === 'feet') {
      for (const bone of result) for (const cube of bone.cubes ?? []) cube.size = [cube.size[0], 1, cube.size[2]]
    }
    return result
  }
  addLayer(
    model,
    bones(),
    mobMaterial(loadTexture(texture), leather ? (item.color ?? LEATHER) : null),
    size
  )
  // Leather's undyed trim sits just over the dyed layer.
  const overlay = leather ? textures.leather_overlay : undefined
  if (overlay !== undefined) {
    addLayer(model, bones(0.01), mobMaterial(loadTexture(overlay)), size)
  }
  return true
}

const isHumanoid = (model: MobModel) =>
  ['head', 'body', 'rightarm', 'leftarm', 'rightleg', 'leftleg'].every((name) => model.boneData.has(name))

// Where the hand is on an arm bone, relative to its pivot: the bottom middle of its box, in pixels.
const handOffset = (model: MobModel, arm: string) => {
  const cube = model.boneData.get(arm)?.cubes?.[0]
  const pivot = model.pivots.get(arm)
  if (!cube || !pivot) return null
  return new THREE.Vector3(
    cube.origin[0] + cube.size[0] / 2 - pivot.x,
    cube.origin[1] + 1 - pivot.y,
    cube.origin[2] + cube.size[2] / 2 - pivot.z
  )
}

// Tools and sticks are held by the handle with the head pointing forward; other items stand upright.
// Their size (pixels), how far along the shaft the fist is from the middle, and the upward tilt.
const HANDHELD_SIZE = 12
const HANDHELD_GRIP = HANDHELD_SIZE * 0.42
const HANDHELD_TILT = Math.PI / 9
const HANDHELD =
  /_(sword|pickaxe|axe|shovel|hoe|spear)$|^(stick|blaze_rod|breeze_rod|bone|fishing_rod|carrot_on_a_stick|warped_fungus_on_a_stick|mace|trident)$/

const holdItem = (model: MobModel, arm: string, name: string) => {
  const group = model.bones.get(arm)
  const hand = handOffset(model, arm)
  if (!group || !hand) return
  if (name === 'shield') {
    const holder = buildHeldShield(arm === 'leftarm' ? 1 : -1)
    holder.position.add(hand)
    holder.traverse(object => {
      const material = (object as THREE.Mesh).material
      if (material && !Array.isArray(material)) model.materials.push(material as THREE.MeshLambertMaterial)
    })
    group.add(holder)
    return
  }
  const item = buildItemMesh(name)
  if (!item) return
  // Placed in pixels from the hand.
  const holder = new THREE.Group()
  holder.position.copy(hand)
  if (item.block) {
    item.object.scale.setScalar(6)
    item.object.position.set(0, -2, -3)
    item.object.rotation.y = Math.PI / 4
  } else if (HANDHELD.test(name)) {
    // Tool textures run corner to corner, handle bottom-left to head top-right. The diagonal is turned to
    // point forward (-z), tilted up a little, with the flat side facing out, and gripped a bit up from the
    // handle's end, so the head leads like the game's.
    holder.rotation.set(HANDHELD_TILT, Math.PI / 2, 0)
    const grip = new THREE.Group()
    grip.position.set(HANDHELD_GRIP, 0, 0)
    grip.rotation.z = -Math.PI / 4
    item.object.scale.setScalar(HANDHELD_SIZE)
    grip.add(item.object)
    holder.add(grip)
    group.add(holder)
    return
  } else {
    item.object.scale.setScalar(8)
    item.object.position.set(0, -2, -3)
    item.object.rotation.y = Math.PI / 2
  }
  holder.add(item.object)
  group.add(holder)
}

// A carved pumpkin, mob head or other block on the head slot is drawn as a cube around the head.
const wearOnHead = (model: MobModel, name: string) => {
  const head = model.bones.get('head')
  const cube = model.boneData.get('head')?.cubes?.[0]
  const pivot = model.pivots.get('head')
  const item = buildItemMesh(name)
  if (!head || !cube || !pivot || !item?.block) return
  item.object.scale.setScalar(cube.size[0] + 2)
  item.object.position.set(
    cube.origin[0] + cube.size[0] / 2 - pivot.x,
    cube.origin[1] + cube.size[1] / 2 - pivot.y,
    cube.origin[2] + cube.size[2] / 2 - pivot.z
  )
  head.add(item.object)
}

export const addEquipment = (model: MobModel, equipment: Equipment | undefined) => {
  if (!equipment) return
  const humanoid = isHumanoid(model)
  for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
    const item = equipment[slot]
    if (!item || !humanoid) continue
    if (!addArmorPiece(model, slot, item) && slot === 'head') {
      wearOnHead(model, item.name)
    }
  }
  if (equipment.mainhand && model.bones.has('rightarm')) holdItem(model, 'rightarm', equipment.mainhand.name)
  if (equipment.offhand && model.bones.has('leftarm')) holdItem(model, 'leftarm', equipment.offhand.name)
}
