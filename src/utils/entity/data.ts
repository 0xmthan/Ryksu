// Typed access to the generated mob data (scripts/assets/mobModels.js).
import generated from '../../generated/entityModels.json'

export type Cube = {
  origin: number[]
  size: number[]
  uv: number[]
  inflate?: number
  rotation?: number[]
  pivot?: number[]
  mirror?: boolean
}

export type Bone = {
  name: string
  parent?: string
  pivot?: number[]
  rotation?: number[]
  bind_pose_rotation?: number[]
  cubes?: Cube[]
  neverRender?: boolean
}

export type EntityEntry = {
  texture: number
  bones: Bone[]
  // Texture per variant name (cat breed, horse color, …).
  variants?: Record<string, number>
  // A second layer drawn over the body (the sheep's wool).
  coat?: { texture: number; bones: Bone[] }
  baby?: EntityEntry
  villagerTypes?: (number | null)[]
  markings?: Record<string, number>
}

export const entityData = generated as unknown as {
  textures: { src: string; width?: number; height?: number }[]
  entities: Record<string, EntityEntry>
  // Villager outfit layers by registry id (null where there's no texture, e.g. no profession).
  layers: Record<string, { types: (number | null)[]; professions: (number | null)[] }>
  horseMarkings: Record<string, number>
  // Armor textures by material for the 64×32 humanoid layers.
  armor: {
    humanoid: Record<string, number>
    humanoid_leggings: Record<string, number>
    humanoid_baby: Record<string, number>
  }
}

// Mobs drawn with another mob's model and textures.
const MODEL_ALIASES: Record<string, string> = { trader_llama: 'llama' }

export const modelType = (type: string | null | undefined) => (type ? (MODEL_ALIASES[type] ?? type) : type)
