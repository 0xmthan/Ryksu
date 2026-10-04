import type { Item } from 'prismarine-item'
import * as armor from '../data/armor'
const armorTypes = Object.keys(armor.TypeDestination)
export const isArmor = (item: Item | null | undefined) => {
  return (
    item &&
    (armorTypes.some((type) => item.name.endsWith(type)) ||
      armor.offhandMaterials.some((type) => item.name === type))
  )
}
