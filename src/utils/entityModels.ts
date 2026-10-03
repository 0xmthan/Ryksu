// Builds 3D mob models for the watcher from Bedrock-style geometry (bones made of textured cubes).
// Ported from prismarine-viewer's Entity.js (MIT); each bone is a group so limbs can swing when walking.
import * as THREE from 'three'
import entityData from '../generated/entityModels.json'

type Cube = {
  origin: number[]
  size: number[]
  uv: number[]
  inflate?: number
  rotation?: number[]
  pivot?: number[]
  mirror?: boolean
}
type Bone = {
  name: string
  parent?: string
  pivot?: number[]
  rotation?: number[]
  bind_pose_rotation?: number[]
  cubes?: Cube[]
  neverRender?: boolean
}

const data = entityData as unknown as {
  textures: { src: string; width?: number; height?: number }[]
  entities: Record<string, { texture: number; bones: Bone[] }>
  // Villager outfit layers by registry id (null where there's no texture, e.g. no profession).
  layers: Record<string, { types: (number | null)[]; professions: (number | null)[] }>
}

// Which texture rows/columns each face of a cube box uses, in multiples of the box size (Entity.js).
const FACES = [
  {
    dir: [0, 1, 0],
    u0: [0, 0, 1],
    v0: [0, 0, 0],
    u1: [1, 0, 1],
    v1: [0, 0, 1],
    corners: [
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0],
      [0, 1, 0, 0, 1],
      [1, 1, 0, 1, 1],
    ],
  },
  {
    dir: [0, -1, 0],
    u0: [1, 0, 1],
    v0: [0, 0, 0],
    u1: [2, 0, 1],
    v1: [0, 0, 1],
    corners: [
      [1, 0, 1, 0, 0],
      [0, 0, 1, 1, 0],
      [1, 0, 0, 0, 1],
      [0, 0, 0, 1, 1],
    ],
  },
  {
    dir: [1, 0, 0],
    u0: [0, 0, 0],
    v0: [0, 0, 1],
    u1: [0, 0, 1],
    v1: [0, 1, 1],
    corners: [
      [1, 1, 1, 0, 0],
      [1, 0, 1, 0, 1],
      [1, 1, 0, 1, 0],
      [1, 0, 0, 1, 1],
    ],
  },
  {
    dir: [-1, 0, 0],
    u0: [1, 0, 1],
    v0: [0, 0, 1],
    u1: [1, 0, 2],
    v1: [0, 1, 1],
    corners: [
      [0, 1, 0, 0, 0],
      [0, 0, 0, 0, 1],
      [0, 1, 1, 1, 0],
      [0, 0, 1, 1, 1],
    ],
  },
  {
    dir: [0, 0, -1],
    u0: [0, 0, 1],
    v0: [0, 0, 1],
    u1: [1, 0, 1],
    v1: [0, 1, 1],
    corners: [
      [1, 0, 0, 0, 1],
      [0, 0, 0, 1, 1],
      [1, 1, 0, 0, 0],
      [0, 1, 0, 1, 0],
    ],
  },
  {
    dir: [0, 0, 1],
    u0: [1, 0, 2],
    v0: [0, 0, 1],
    u1: [2, 0, 2],
    v1: [0, 1, 1],
    corners: [
      [0, 0, 1, 0, 1],
      [1, 0, 1, 1, 1],
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0],
    ],
  },
]

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const toEuler = (degrees: number[]) =>
  new THREE.Euler(
    THREE.MathUtils.degToRad(-degrees[0]),
    THREE.MathUtils.degToRad(-degrees[1]),
    THREE.MathUtils.degToRad(-degrees[2])
  )

const pixelated = <T extends THREE.Texture>(texture: T) => {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.flipY = false
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const textureCache = new Map<number, THREE.Texture>()
const loadTexture = (index: number) => {
  let texture = textureCache.get(index)
  if (!texture) {
    texture = pixelated(new THREE.TextureLoader().load(data.textures[index].src))
    textureCache.set(index, texture)
  }
  return texture
}

const loadImage = async (src: string) => {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}

// A player's own skin (a data URL fetched by the main process).
const skinCache = new Map<string, THREE.Texture>()
export const skinTexture = (dataUrl: string) => {
  let texture = skinCache.get(dataUrl)
  if (!texture) {
    texture = pixelated(new THREE.TextureLoader().load(dataUrl))
    skinCache.set(dataUrl, texture)
  }
  return texture
}

// Villagers wear a biome outfit and a profession outfit over their base skin; the layers are drawn
// into one texture, the way the game stacks them.
const outfitCache = new Map<string, Promise<THREE.Texture>>()
export const villagerTexture = (type: string, villager: { type: number; profession: number }) => {
  const key = `${type}:${villager.type}:${villager.profession}`
  let texture = outfitCache.get(key)
  if (!texture) {
    texture = (async () => {
      const layers = data.layers[type]
      const indices = [
        data.entities[type].texture,
        layers?.types[villager.type],
        layers?.professions[villager.profession],
      ]
      const images = await Promise.all(
        indices
          .filter((index): index is number => typeof index === 'number')
          .map((index) => loadImage(data.textures[index].src))
      )
      const canvas = document.createElement('canvas')
      canvas.width = images[0].naturalWidth
      canvas.height = images[0].naturalHeight
      const context = canvas.getContext('2d')!
      for (const image of images) {
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
      }
      return pixelated(new THREE.CanvasTexture(canvas))
    })()
    outfitCache.set(key, texture)
  }
  return texture
}

// Geometry for one bone's cubes, relative to the bone's pivot. The bone's own rotation is baked in
// here (as Entity.js does), since in this format it turns only its cubes, not its child bones.
const boneGeometry = (
  cubes: Cube[],
  pivot: THREE.Vector3,
  boneRotation: THREE.Euler | null,
  uScale: number,
  vScale: number
) => {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const point = new THREE.Vector3()
  for (const cube of cubes) {
    const inflate = cube.inflate ?? 0
    const cubeRotation = cube.rotation ? toEuler(cube.rotation) : null
    const cubePivot = new THREE.Vector3(...(cube.pivot ?? [0, 0, 0]))
    for (const { dir, corners, u0, v0, u1, v1 } of FACES) {
      const base = positions.length / 3
      for (const corner of corners) {
        point.set(
          cube.origin[0] + corner[0] * cube.size[0] + (corner[0] ? inflate : -inflate),
          cube.origin[1] + corner[1] * cube.size[1] + (corner[1] ? inflate : -inflate),
          cube.origin[2] + corner[2] * cube.size[2] + (corner[2] ? inflate : -inflate)
        )
        if (cubeRotation) {
          point.sub(cubePivot).applyEuler(cubeRotation).add(cubePivot)
        }
        point.sub(pivot)
        if (boneRotation) {
          point.applyEuler(boneRotation)
        }
        positions.push(point.x, point.y, point.z)
        normals.push(dir[0], dir[1], dir[2])
        uvs.push(
          (cube.uv[0] + dot(corner[3] ? u1 : u0, cube.size)) * uScale,
          (cube.uv[1] + dot(corner[4] ? v1 : v0, cube.size)) * vScale
        )
      }
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

export type MobModel = {
  root: THREE.Object3D
  material: THREE.MeshLambertMaterial
  // Limbs that swing while walking, with which way each starts.
  limbs: { bone: THREE.Object3D; restX: number; phase: number }[]
}

export const hasMobModel = (type: string | null | undefined): type is string =>
  Boolean(type && data.entities[type])

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

export const buildMobModel = (type: string, options: { slim?: boolean } = {}): MobModel => {
  const entity = { ...data.entities[type] }
  if (options.slim) {
    entity.bones = slimArms(entity.bones)
  }
  const textureInfo = data.textures[entity.texture]
  const material = new THREE.MeshLambertMaterial({
    map: loadTexture(entity.texture),
    transparent: true,
    alphaTest: 0.1,
    side: THREE.DoubleSide,
  })
  // The texture is cached and shared, so disposing one mob mustn't free it.
  material.userData.sharedMap = true
  // Geometry UVs are in texture pixels; old 64×32 layouts still line up with today's 64×64 textures.
  const uScale = 1 / (textureInfo.width ?? 64)
  const vScale = 1 / (textureInfo.height ?? 64)

  const groups = new Map<string, THREE.Group>()
  const pivots = new Map<string, THREE.Vector3>()
  for (const bone of entity.bones) {
    const group = new THREE.Group()
    group.name = bone.name
    const pivot = new THREE.Vector3(...(bone.pivot ?? [0, 0, 0]))
    pivots.set(bone.name, pivot)
    const rotation = bone.bind_pose_rotation ?? bone.rotation
    if (bone.cubes?.length && !bone.neverRender) {
      const geometry = boneGeometry(bone.cubes, pivot, rotation ? toEuler(rotation) : null, uScale, vScale)
      group.add(new THREE.Mesh(geometry, material))
    }
    groups.set(bone.name, group)
  }

  // Pixels → blocks; the model's front faces -z, which is yaw 0 in Minecraft.
  const root = new THREE.Group()
  const model = new THREE.Group()
  model.scale.setScalar(1 / 16)
  root.add(model)
  for (const bone of entity.bones) {
    const group = groups.get(bone.name)!
    const pivot = pivots.get(bone.name)!
    const parent = bone.parent ? groups.get(bone.parent) : undefined
    if (parent) {
      group.position.copy(pivot).sub(pivots.get(bone.parent!)!)
      parent.add(group)
    } else {
      group.position.copy(pivot)
      model.add(group)
    }
  }

  const limbs: MobModel['limbs'] = []
  for (const [name, group] of groups) {
    const lower = name.toLowerCase()
    if (/leg|arm/.test(lower) && !/sleeve|pants|armor/.test(lower)) {
      // Opposite limbs swing opposite ways; arms swing against the leg on the same side.
      const right = /right|leg0|leg2/.test(lower) ? 1 : -1
      const arm = /arm/.test(lower) ? -1 : 1
      const front = /leg[23]/.test(lower) ? -1 : 1
      limbs.push({ bone: group, restX: group.rotation.x, phase: right * arm * front })
    }
  }
  return { root, material, limbs }
}

// Swings limbs by `amount` (0 standing still, 1 full stride) at walk cycle position `time`.
export const animateWalk = (model: MobModel, time: number, amount: number) => {
  for (const limb of model.limbs) {
    limb.bone.rotation.x = limb.restX + Math.sin(time) * 0.8 * amount * limb.phase
  }
}
