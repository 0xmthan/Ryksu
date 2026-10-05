// Builds 3D mob models for the watcher from Bedrock-style geometry (bones made of textured cubes). Each
// bone is a group so limbs can move; extra layers (wool, armor) are added onto the same bones.
import * as THREE from 'three'
import { entityData, type Bone, type EntityEntry } from './data'
import { boneGeometry, toEuler } from './geometry'
import { loadTexture } from './textures'

export type MobModel = {
  type: string
  entry: EntityEntry
  // The whole model in blocks, facing -z (yaw 0); baby scale and the death tilt go here.
  root: THREE.Group
  // Inside root: the model in pixels, which whole-body poses (sitting) turn and shift.
  frame: THREE.Group
  // The main texture's material, for swapping in skins and outfits.
  skin: THREE.MeshLambertMaterial
  // Every material on the model, for the hurt tint.
  materials: THREE.MeshLambertMaterial[]
  // Bone groups, data and pivots by lower-case name (the geometry mixes "rightArm" and "rightarm").
  bones: Map<string, THREE.Group>
  boneData: Map<string, Bone>
  pivots: Map<string, THREE.Vector3>
}

export const hasMobModel = (type: string | null | undefined): type is string =>
  Boolean(type && entityData.entities[type])

const key = (name: string) => name.toLowerCase()

export const textureSize = (index: number) => {
  const info = entityData.textures[index]
  return { width: info.width ?? 64, height: info.height ?? 64 }
}

export const mobMaterial = (map: THREE.Texture, color?: string | null) => {
  const material = new THREE.MeshLambertMaterial({
    map,
    transparent: true,
    alphaTest: 0.1,
    side: THREE.DoubleSide,
  })
  if (color) material.color.set(color)
  // Remembered so the hurt tint can be undone.
  material.userData.baseColor = material.color.clone()
  // Textures are cached and shared, so disposing one mob mustn't free them.
  material.userData.sharedMap = true
  return material
}

// Adds cubes onto the model's bones (matched by name), drawn with `material` from a texture of the given
// size. Used for the body itself and for layers over it.
export const addLayer = (
  model: MobModel,
  bones: Bone[],
  material: THREE.MeshLambertMaterial,
  size: { width: number; height: number }
) => {
  if (!model.materials.includes(material)) model.materials.push(material)
  for (const bone of bones) {
    const group = model.bones.get(key(bone.name))
    if (!group || !bone.cubes?.length || bone.neverRender) continue
    const pivot = new THREE.Vector3(...(bone.pivot ?? [0, 0, 0]))
    const rotation = bone.bind_pose_rotation ?? bone.rotation
    const geometry = boneGeometry(
      bone.cubes,
      pivot,
      rotation ? toEuler(rotation) : null,
      1 / size.width,
      1 / size.height
    )
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    group.add(mesh)
  }
}

// Slim ("Alex") player skins have 3-pixel arms against the body, using the same texture spots.
const slimArms = (bones: Bone[]): Bone[] =>
  bones.map((bone) => {
    const side = /^left(Arm|Sleeve)$/.test(bone.name)
      ? 'left'
      : /^right(Arm|Sleeve)$/.test(bone.name)
        ? 'right'
        : null
    if (!side || !bone.cubes) return bone
    return {
      ...bone,
      cubes: bone.cubes.map((cube) => ({
        ...cube,
        origin: [side === 'left' ? cube.origin[0] : cube.origin[0] + 1, cube.origin[1], cube.origin[2]],
        size: [3, cube.size[1], cube.size[2]],
      })),
    }
  })

// `texture` picks another texture for the body (a variant); it must share the base texture's layout.
export const buildMobModel = (type: string, options: { slim?: boolean; texture?: number; baby?: boolean } = {}): MobModel => {
  const adult = entityData.entities[type]
  const entry = options.baby && adult.baby ? adult.baby : adult
  const bones = options.slim ? slimArms(entry.bones) : entry.bones
  const textureIndex = options.texture ?? entry.texture
  const skin = mobMaterial(loadTexture(textureIndex))

  const root = new THREE.Group()
  // Pixels → blocks.
  const scaled = new THREE.Group()
  scaled.scale.setScalar(1 / 16)
  root.add(scaled)

  const model: MobModel = {
    type,
    entry,
    root,
    frame: scaled,
    skin,
    materials: [],
    bones: new Map(),
    boneData: new Map(),
    pivots: new Map(),
  }
  for (const bone of bones) {
    const group = new THREE.Group()
    group.name = bone.name
    model.bones.set(key(bone.name), group)
    model.boneData.set(key(bone.name), bone)
    model.pivots.set(key(bone.name), new THREE.Vector3(...(bone.pivot ?? [0, 0, 0])))
  }
  for (const bone of bones) {
    const group = model.bones.get(key(bone.name))!
    const pivot = model.pivots.get(key(bone.name))!
    const parentKey = bone.parent ? key(bone.parent) : null
    const parent = parentKey ? model.bones.get(parentKey) : undefined
    if (parent) {
      group.position.copy(pivot).sub(model.pivots.get(parentKey!)!)
      parent.add(group)
    } else {
      group.position.copy(pivot)
      scaled.add(group)
    }
  }
  addLayer(model, bones, skin, textureSize(textureIndex))
  return model
}

// The sheep's wool coat, dyed; nothing for a sheared sheep or a mob without a coat.
export const addCoat = (model: MobModel, color: string) => {
  const coat = model.entry.coat
  if (!coat) return
  const material = mobMaterial(loadTexture(coat.texture), color)
  if (model.type === 'sheep' && model.entry === entityData.entities.sheep.baby) {
    // Baby fleece shares the body's exact surface; keep the overlay stable at equal depth.
    material.polygonOffset = true
    material.polygonOffsetFactor = -1
    material.polygonOffsetUnits = -1
  }
  addLayer(model, coat.bones, material, textureSize(coat.texture))
}
