const armor = require('../data/armor')
const findItemById = (inventory, itemId) => inventory.slots.find((item) => item && item.type === itemId)
exports.findItemById = findItemById
const findArmorDestinationIndex = (item) => {
  let index = armor.DESTINATIONS.findIndex((destination) => item.name.endsWith(destination))
  if (index < 0) index = armor.offhandMaterials.some((mat) => item.name === mat) ? 4 : -1
  return index
}
exports.findArmorDestinationIndex = findArmorDestinationIndex
const findArmorDestination = (item) => {
  let type = armor.DESTINATIONS.find((destination) => item.name.endsWith(destination))
  if (!type && armor.offhandMaterials.some((mat) => item.name === mat)) type = 'off-hand'
  return type && armor.TypeDestination[type]
}
exports.findArmorDestination = findArmorDestination
const getRank = (item) => {
  const index = armor.materials.findIndex((mat) => item.name.startsWith(mat))
  if (index >= 0) return index
  return armor.offhandMaterials.findIndex((mat) => item.name === mat)
}
const isNewArmorBetter = (oldArmor, newArmor) => {
  const oldArmorRank = getRank(oldArmor)
  const newArmorRank = getRank(newArmor)
  return newArmorRank > oldArmorRank
}
exports.isNewArmorBetter = isNewArmorBetter
/**
 * Get equipped items(workaround because of https://github.com/PrismarineJS/mineflayer/issues/397)
 */
const equipped = (inventory, supportsOffhand) =>
  inventory.slots.slice(5, 9).concat(supportsOffhand ? [inventory.slots[45]] : [])
exports.equipped = equipped
