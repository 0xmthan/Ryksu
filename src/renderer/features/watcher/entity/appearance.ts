// A mob or player model dressed the way it looks in game: its variant texture, villager outfit, horse
// markings, sheep wool, player skin, armor and held items.
import type * as THREE from 'three'
import type { MotionEntity } from '../../../../shared/types'
import { entityData, modelType } from './data'
import { addCape } from './cape'
import { addEquipment } from './equipment'
import { addCoat, buildMobModel, hasMobModel, type MobModel } from './model'
import { layeredTexture, shearedSheepTexture, textureFromUrl, villagerTexture } from './textures'

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

// How cracked an iron golem looks, by the share of its 100 health left (the game's thresholds).
const GOLEM_HEALTH = 100
const crackiness = (entity: MotionEntity) => {
  if (entity.type !== 'iron_golem' || entity.health === undefined) return null
  const left = entity.health / GOLEM_HEALTH
  return left < 0.25 ? 'high' : left < 0.5 ? 'medium' : left < 0.75 ? 'low' : null
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
    entity.shearedColor,
    entity.villager,
    entity.skin,
    entity.cape,
    entity.slim,
    entity.equipment,
    crackiness(entity),
  ])

export const buildEntityModel = (entity: MotionEntity): MobModel | null => {
  const type = modelType(entity.type)
  if (entity.kind === 'item' || !hasMobModel(type)) return null
  const adult = entityData.entities[type]
  const entry = entity.baby && adult.baby ? adult.baby : adult
  const variants = entry.variants
  const variant = entity.variant ? variants?.[entity.variant] : undefined
  const model = buildMobModel(type, { slim: entity.slim, texture: variant, baby: entity.baby })

  if (entity.baby && !adult.baby) {
    model.root.scale.setScalar(0.5)
  }
  if (entity.villager) {
    const babyOutfit = entry.villagerTypes?.[entity.villager.type]
    if (babyOutfit != null) {
      swapTexture(model, layeredTexture([babyOutfit]))
    } else {
      swapTexture(model, villagerTexture(type, entity.villager))
    }
  }
  const markings = entity.markings ? (entry.markings ?? entityData.horseMarkings)[entity.markings] : undefined
  if (markings !== undefined) {
    swapTexture(model, layeredTexture([variant ?? entry.texture, markings]))
  }
  const cracks = crackiness(entity)
  if (cracks && entry.cracks?.[cracks] !== undefined) {
    swapTexture(model, layeredTexture([variant ?? entry.texture, entry.cracks[cracks]]))
  }
  // Sheep wear white wool until the server says otherwise; null means sheared.
  if (entity.wool !== null) {
    addCoat(model, entity.wool ?? '#f9fffe')
  }
  if (type === 'sheep' && entity.wool === null && entity.shearedColor) {
    swapTexture(model, shearedSheepTexture(entity.shearedColor, entry.texture))
  }
  if (entity.skin) {
    applySkin(model, entity.skin)
  }
  if (entity.kind === 'player' && entity.cape && entity.equipment?.chest?.name !== 'elytra') {
    addCape(model, entity.cape, Boolean(entity.equipment?.chest))
  }
  addEquipment(model, entity.equipment)
  return model
}
