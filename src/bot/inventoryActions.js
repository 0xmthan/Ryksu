// Inventory changes requested from the dashboard. Slot numbers are the player window's:
// 5-8 armor, 9-35 main inventory, 36-44 hotbar, 45 offhand.
const FIRST_SLOT = 5
const LAST_SLOT = 45
const HOTBAR_START = 36
const DROP_MODE = 4

const assertSlot = (slot) => {
  if (!Number.isInteger(slot) || slot < FIRST_SLOT || slot > LAST_SLOT) {
    throw new Error(`Invalid inventory slot ${slot}.`)
  }
}

const runInventoryAction = async (bot, action = {}) => {
  if (!bot?.inventory) {
    throw new Error('The bot is not in the world yet.')
  }
  if (bot.currentWindow) {
    throw new Error('The bot has a chest open right now. Try again in a moment.')
  }

  switch (action.type) {
    case 'move': {
      assertSlot(action.from)
      assertSlot(action.to)
      if (action.from === action.to) {
        return
      }
      if (!bot.inventory.slots[action.from]) {
        throw new Error('That slot is empty.')
      }
      // Moves into an empty slot, merges matching stacks, or swaps the two.
      await bot.moveSlotItem(action.from, action.to)
      return
    }
    case 'drop': {
      assertSlot(action.slot)
      if (!bot.inventory.slots[action.slot]) {
        throw new Error('That slot is empty.')
      }
      // Button 0 drops one item, button 1 the whole stack (like Q and Ctrl+Q in game).
      await bot.clickWindow(action.slot, action.all ? 1 : 0, DROP_MODE)
      return
    }
    case 'hold': {
      assertSlot(action.slot)
      if (action.slot < HOTBAR_START || action.slot >= HOTBAR_START + 9) {
        throw new Error('Only hotbar slots can be held.')
      }
      bot.setQuickBarSlot(action.slot - HOTBAR_START)
      return
    }
    default:
      throw new Error(`Unknown inventory action "${action.type}".`)
  }
}

module.exports = { runInventoryAction }
