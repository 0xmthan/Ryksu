import type { CoreBot } from '../../types'
import * as invUtil from './invUtil'
/**
 * Search for item in bot's inventory and equips it
 * @return {Boolean}   true if item equipped successfully, false if something went wrong
 */
export const equipItem = async (bot: CoreBot, itemId: number) => {
  const item = invUtil.findItemById(bot.inventory, itemId)
  const equipped = invUtil.equipped(bot.inventory, !bot.supportFeature('doesntHaveOffHandSlot'))
  if (!item) {
    return false
  }
  const destination = invUtil.findArmorDestination(item)
  const destinationIndex = invUtil.findArmorDestinationIndex(item)
  if (destinationIndex < 0 || !destination) {
    return false
  }
  const equippedArmor = equipped[destinationIndex]
  if (!equippedArmor || invUtil.isNewArmorBetter(equippedArmor, item)) {
    await bot.equip(item, destination)
    return true
  }
  return false
}
