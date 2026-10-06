import type { CoreBot } from '../types'
import * as armor from './lib/isArmor'
import * as equipment from './lib/equipItem'
export const initializeBot = (bot: CoreBot) => {
  if (!bot) {
    throw new Error('Bot object is missing, provide mineflayer bot as first argument')
  }
  bot.armorManager = {
    equipAll: async () => {
      for (const item of bot.inventory.items()) {
        await equipment.equipItem(bot, item.type)
      }
    },
  }
  bot.on('playerCollect', (collector, collected) => {
    if (collector.username !== bot.username) {
      return
    }
    const item = collected.getDroppedItem()
    if (item != null && armor.isArmor(item)) {
      // Little delay to receive inventory
      setTimeout(() => equipment.equipItem(bot, item.type), 100)
    }
  })
}
