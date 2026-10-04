const armor = require('../data/armor')
const armorTypes = Object.keys(armor.TypeDestination)
const isArmor = (item) => {
  return (
    item &&
    (armorTypes.some((type) => item.name.endsWith(type)) ||
      armor.offhandMaterials.some((type) => item.name === type))
  )
}
exports.isArmor = isArmor
