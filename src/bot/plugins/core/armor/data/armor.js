/** Mapping of values of which kind of armor goes to which slot */
const TypeDestination = {
  helmet: 'head',
  chestplate: 'torso',
  leggings: 'legs',
  boots: 'feet',
  'off-hand': 'off-hand',
}
exports.TypeDestination = TypeDestination
exports.DESTINATIONS = Object.keys(TypeDestination)
/** Ranked list of armor materials from worst to best */
exports.materials = ['leather', 'golden', 'iron', 'chainmail', 'turtle', 'diamond', 'netherite']
/** Ranked list of offhand materials from worst to best */
exports.offhandMaterials = ['shield', 'totem_of_undying']
