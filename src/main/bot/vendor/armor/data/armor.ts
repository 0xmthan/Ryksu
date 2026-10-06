/** Mapping of values of which kind of armor goes to which slot */
export const TypeDestination = {
  helmet: 'head',
  chestplate: 'torso',
  leggings: 'legs',
  boots: 'feet',
  'off-hand': 'off-hand',
} as const
export const DESTINATIONS = Object.keys(TypeDestination) as Array<keyof typeof TypeDestination>
/** Ranked list of armor materials from worst to best */
export const materials = ['leather', 'golden', 'iron', 'chainmail', 'turtle', 'diamond', 'netherite']
/** Ranked list of offhand materials from worst to best */
export const offhandMaterials = ['shield', 'totem_of_undying']
