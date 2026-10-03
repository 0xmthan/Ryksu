// A mob or player model dressed the way it looks in game: its variant texture, villager outfit, horse
// markings, sheep wool, player skin, armor and held items.
import type * as THREE from 'three'
import type { MotionEntity } from '../../types'
import { entityData, modelType } from './data'
import { addEquipment } from './equipment'
import { addCoat, buildMobModel, hasMobModel, type MobModel } from './model'
import { layeredTexture, textureFromUrl, villagerTexture } from './textures'

// Puts a player's own skin on a model once the main process has fetched it.
const applySkin = (model: MobModel, url: string) => {
  window.electronAPI.bot
    .getSkin(url)
    .then((dataUrl) => {
      if (dataUrl) {
        model.skin.map = textureFromUrl(dataUrl)
        model.skin.needsUpdate = true
      }
    })
    .catch(() => {})
}

const swapTexture = (model: MobModel, texture: Promise<THREE.Texture>) => {
  texture
    .then((map) => {
      model.skin.map = map
      model.skin.needsUpdate = true
    })
    .catch(() => {})
}

// Everything that changes how an entity looks; the model is rebuilt when this changes.
export const lookOf = (entity: MotionEntity) =>
  JSON.stringify([
    entity.type,
    entity.item,
    entity.baby,
    entity.variant,
    entity.markings,
    entity.wool,
    entity.villager,
    entity.skin,
    entity.slim,
    entity.equipment,
  ])

export const buildEntityModel = (entity: MotionEntity): MobModel | null => {
  const type = modelType(entity.type)
  if (entity.kind === 'item' || !hasMobModel(type)) return null
  const variants = entityData.entities[type].variants
  const variant = entity.variant ? variants?.[entity.variant] : undefined
  const model = buildMobModel(type, { slim: entity.slim, texture: variant })

  if (entity.baby) {
    model.root.scale.setScalar(0.5)
  }
  if (entity.villager) {
    swapTexture(model, villagerTexture(type, entity.villager))
  }
  const markings = entity.markings ? entityData.horseMarkings[entity.markings] : undefined
  if (markings !== undefined) {
    swapTexture(model, layeredTexture([variant ?? entityData.entities[type].texture, markings]))
  }
  // Sheep wear white wool until the server says otherwise; null means sheared.
  if (entity.wool !== null) {
    addCoat(model, entity.wool ?? '#f9fffe')
  }
  if (entity.skin) {
    applySkin(model, entity.skin)
  }
  addEquipment(model, entity.equipment)
  return model
}
