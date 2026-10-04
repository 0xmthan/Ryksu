const inventory = require('./Inventory')
const nbt = require('prismarine-nbt')
function error(name, message) {
  const e = new Error(message)
  e.name = name
  return e
}
exports.error = error
/**
 * The main class object for the tool plugin.
 */
class Tool {
  /**
   * Creates a new tool plugin instance.
   *
   * @param bot - The bot the plugin is running on.
   */
  constructor(bot) {
    /**
     * A list of chest locations that the bot is allowed to retrieve items from
     * when using the "getFromChest" option.
     */
    this.chestLocations = []
    this.bot = bot
  }
  /**
   * Gets the number of ticks required to mine the target block with the given item.
   *
   * @param block - The block to test against.
   * @param item - The item to test with.
   *
   * @returns The number of ticks it would take to mine.
   */
  getDigTime(block, item) {
    const effects = this.bot.entity.effects
    const enchants = item?.nbt != null ? nbt.simplify(item.nbt).Enchantments : []
    return block.digTime(item?.type, false, false, false, enchants, effects)
  }
  /**
   * Gets the item currently in the bot's hand.
   */
  itemInHand() {
    return this.bot.inventory.slots[this.bot.getEquipmentDestSlot('hand')]
  }
  /**
   * Checks if the best item in the item list is faster than the item in
   * the bot's hand.
   *
   * @param block - The block to test against.
   * @param itemList - The item list to test against.
   *
   * @returns True if the items in the list are better. False if they are worse or
   *          equal to what's already in the bot's hand.
   */
  isBetterMiningTool(block, itemList) {
    const item = this.itemInHand()
    if (item == null) return true
    if (!itemList.includes(item)) return true
    return this.getDigTime(block, itemList[0]) < this.getDigTime(block, item)
  }
  /**
   * This function can be used to equip the best tool currently in the bot's
   * inventory for breaking the given block.
   *
   * @param block - The block the bot is attempting to break.
   * @param options - The options to use for equipping the correct tool.
   * @param cb - The callback.
   */
  async equipForBlock(block, options = {}, cb) {
    let itemList = [...this.bot.inventory.items()]
    // Add an "undefined" item if the bot has empty space in it's inventory.
    if (this.bot.inventory.emptySlotCount() >= 1) {
      itemList.unshift(undefined)
    }
    if (options.requireHarvest != null && options.requireHarvest) {
      itemList = itemList.filter((item) => block.canHarvest(item != null ? item.type : null))
    }
    itemList.sort((a, b) => this.getDigTime(block, a) - this.getDigTime(block, b))
    if (itemList.length === 0) {
      if (options.getFromChest != null && options.getFromChest) {
        try {
          await inventory.retrieveTools(this.bot, {
            toolFilter: inventory.standardToolFilter,
            chestLocations: this.chestLocations,
            toolCostFilter: (item) => this.getDigTime(block, item),
            maxTools: options.maxTools,
          })
          await this.equipForBlock(block, options)
        } catch (err) {
          if (err != null && cb != null) cb(err)
          throw err
        }
        if (cb != null) cb()
        return
      }
      if (options.requireHarvest != null && options.requireHarvest) {
        const err = error('NoItem', 'Bot does not have a harvestable tool!')
        if (cb != null) cb(err)
        throw err
      } else {
        if (cb != null) cb()
      }
      return
    }
    // Don't change item if it has the same performance as the equipped item.
    // Otherwise you just create unneeded equipment calls and can potentially
    // get stuck in an infinite loop in some conditions.
    if (!this.isBetterMiningTool(block, itemList)) {
      if (cb != null) cb()
      return
    }
    const best = itemList[0]
    try {
      if (best != null) {
        await this.bot.equip(best, 'hand')
      } else {
        await this.bot.unequip('hand')
      }
    } catch (err) {
      if (cb != null) cb(err)
      throw err
    }
    if (cb != null) cb()
  }
}
exports.Tool = Tool
