// Inventory changes requested from the dashboard. Slot numbers are the player window's:
// 0 crafting result, 1-4 crafting inputs, 5-8 armor, 9-35 main, 36-44 hotbar, 45 offhand.
import type { Bot } from 'mineflayer'
import type { InventoryAction } from '../types'
import { HOTBAR_START } from '../shared/inventory'

const FIRST_SLOT = 0
const LAST_SLOT = 45
const DROP_MODE = 4

const assertSlot = (slot: number, last = LAST_SLOT) => {
  if (!Number.isInteger(slot) || slot < FIRST_SLOT || slot > last) {
    throw new Error(`Invalid inventory slot ${slot}.`)
  }
}

// `action` comes straight from the renderer, so its fields are checked here rather than trusted.
export const runInventoryAction = async (bot: Bot | null, action: InventoryAction) => {
  if (!bot?.inventory) {
    throw new Error('The bot is not in the world yet.')
  }
  const window = bot.currentWindow ?? bot.inventory
  if ('windowId' in action && action.windowId !== undefined && action.windowId !== window.id) {
    throw new Error('This inventory is no longer open.')
  }
  if (bot.currentWindow && !['click', 'close', 'rename'].includes(action.type)) {
    throw new Error('Close the container before using player inventory actions.')
  }

  switch (action.type) {
    case 'click': {
      if (!Array.isArray(action.clicks) || !action.clicks.length || action.clicks.length > 128) {
        throw new Error('Invalid inventory clicks.')
      }
      // Validate the entire gesture before sending any clicks to the server.
      for (const { slot, button, mode } of action.clicks) {
        if (slot !== -999) assertSlot(slot, window.slots.length - 1)
        if (
          ![0, 1, 2, 4].includes(mode) ||
          !Number.isInteger(button) ||
          button < 0 ||
          button > (mode === 2 ? 8 : 1) ||
          (slot === -999 && mode !== 0)
        )
          throw new Error('Invalid inventory click.')
      }
      for (const { slot, button, mode } of action.clicks) await bot.clickWindow(slot, button, mode)
      return
    }
    case 'close': {
      // Closing window zero lets the server return crafting ingredients and the cursor stack.
      await bot.closeWindow(window)
      return
    }
    case 'rename': {
      if (!/anvil/.test(String(window.type)) || typeof action.name !== 'string' || action.name.length > 35) {
        throw new Error('Invalid anvil name (maximum 35 characters).')
      }
      if (bot.supportFeature('useMCItemName' as never)) {
        bot._client.registerChannel('MC|ItemName', 'string')
        bot._client.writeChannel('MC|ItemName', action.name)
      } else bot._client.write('name_item', { name: action.name })
      return
    }
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
      throw new Error(`Unknown inventory action "${(action as { type?: unknown }).type}".`)
  }
}
