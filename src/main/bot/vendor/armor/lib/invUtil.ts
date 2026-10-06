import type { CoreBot } from '../../types'
import type { Item } from 'prismarine-item'
import * as armor from '../data/armor'
export const findItemById = (inventory: CoreBot['inventory'], itemId: number) =>
  inventory.slots.find((item) => item && item.type === itemId)
export const findArmorDestinationIndex = (item: Item) => {
  let index = armor.DESTINATIONS.findIndex((destination) => item.name.endsWith(destination))
  if (index < 0) index = armor.offhandMaterials.some((mat) => item.name === mat) ? 4 : -1
  return index
}
export const findArmorDestination = (item: Item) => {
  let type: keyof typeof armor.TypeDestination | undefined = armor.DESTINATIONS.find((destination) =>
    item.name.endsWith(destination)
  )
  if (!type && armor.offhandMaterials.some((mat) => item.name === mat)) type = 'off-hand'
  return type && armor.TypeDestination[type]
}
const getRank = (item: Item) => {
  const index = armor.materials.findIndex((mat) => item.name.startsWith(mat))
  if (index >= 0) return index
  return armor.offhandMaterials.findIndex((mat) => item.name === mat)
}
export const isNewArmorBetter = (oldArmor: Item, newArmor: Item) => {
  const oldArmorRank = getRank(oldArmor)
  const newArmorRank = getRank(newArmor)
  return newArmorRank > oldArmorRank
}
/**
 * Get equipped items(workaround because of https://github.com/PrismarineJS/mineflayer/issues/397)
 */
export const equipped = (inventory: CoreBot['inventory'], supportsOffhand: boolean) =>
  inventory.slots.slice(5, 9).concat(supportsOffhand ? [inventory.slots[45]] : [])
