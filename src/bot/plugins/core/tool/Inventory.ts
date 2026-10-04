import type { CoreBot, Callback } from '../types'
import type { Item } from 'prismarine-item'
import type { Vec3 } from 'vec3'
export interface ToolRetrievalOptions {
  chestLocations: Vec3[]
  toolFilter(item: Item): boolean
  toolCostFilter(item: Item): number
  maxTools?: number
}
import * as tool from './Tool'
import { goals } from '../pathfinder'
import { setTimeout as wait } from 'node:timers/promises'
/**
 * A standard tool filter that returns true for all tools and false
 * for everything else.
 *
 * @param item - The item to test against.
 */
export function standardToolFilter(item: Item) {
  if (item.name.includes('sword')) return true
  if (item.name.includes('pickaxe')) return true
  if (item.name.includes('shovel')) return true
  if (item.name.includes('axe')) return true
  if (item.name.includes('hoe')) return true
  return false
}
/**
 * Moves from chest to chest in an effort to get at least one tool that meets the given requirements.
 * Throws an error in the callback if a tool cannot be retrieved.
 *
 * @param bot - The bot.
 * @param options - The options to use when collecting tools.
 * @param cb - The callback to execute when the function has completed.
 */
export async function retrieveTools(bot: CoreBot, options: ToolRetrievalOptions, cb?: Callback) {
  const chestLocations = [...options.chestLocations]
  while (chestLocations.length > 0) {
    const chest = getClosestChest(bot, chestLocations)
    if (chest == null) {
      const err = tool.error('NoChest', 'There are no chests with available tools in them!')
      if (cb != null && typeof cb === 'function') cb(err)
      throw err
    }
    chestLocations.splice(chestLocations.indexOf(chest), 1)
    try {
      console.info('Going to chest', chest)
      await gotoChest(bot, chest)
      console.info('Pulling from chest', chest, options)
      const gotItem = await pullFromChest(bot, chest, options)
      if (gotItem) {
        if (cb != null) cb()
        return
      }
    } catch (err) {
      if (cb != null) cb(err)
      throw err
    }
  }
}
/**
 * Moves the bot to the chest.
 *
 * @param bot - The bot to move.
 * @param location - The location to move to.
 * @param cb - The callback to run when finished.
 * @returns {Promise<void>}
 */
async function gotoChest(bot: CoreBot, location: Vec3, cb?: Callback) {
  const pathfinder = bot.pathfinder
  try {
    await pathfinder.goto(new goals.GoalGetToBlock(location.x, location.y, location.z))
  } catch (err) {
    if (cb != null && typeof cb === 'function') cb(err)
    throw err
  }
}
/**
 * Pull items from a given chest
 * @param bot Bot
 * @param chestPos Chest Position
 * @param options Tool Retrieval Options {@link ToolRetrievalOptions}
 * @param cb Optional callback
 * @returns {Promise<boolean>}
 */
async function pullFromChest(
  bot: CoreBot,
  chestPos: Vec3,
  options: ToolRetrievalOptions,
  cb?: (error?: unknown, gotItem?: boolean) => void
) {
  const chestBlock = bot.blockAt(chestPos)
  if (chestBlock == null) {
    const err = tool.error('UnloadedChunk', 'Chest is located in an unloaded chunk!')
    if (cb != null && typeof cb === 'function') cb(err, false)
    throw err
  }
  try {
    const chest = await bot.openChest(chestBlock)
    let itemsToPull = []
    for (const item of chest.items()) {
      if (options.toolFilter(item)) {
        itemsToPull.push(item)
      }
    }
    if (itemsToPull.length === 0) {
      if (cb != null && typeof cb === 'function') cb(undefined, false)
      return false
    }
    itemsToPull.sort((a, b) => options.toolCostFilter(a) - options.toolCostFilter(b))
    const maxTools = options.maxTools ?? 1
    if (itemsToPull.length > maxTools) {
      itemsToPull = itemsToPull.slice(0, maxTools)
    }
    for (const item of itemsToPull) {
      await chest.withdraw(item.type, item.metadata, item.count)
    }
    chest.close()
    await wait(200) // Wait for server to update inventory
  } catch (err) {
    if (cb != null && typeof cb === 'function') cb(err, true)
    throw err
  }
  return true
}
/**
 * Gets the location of the nearest chest.
 *
 * @param bot - The bot.
 * @param chestLocations - The list of all chest locations.
 *
 * @returns The nearest chest location, or null if the chest location
 *          array is empty.
 */
function getClosestChest(bot: CoreBot, chestLocations: Vec3[]) {
  let location: Vec3 | null = null
  let distance = 0
  for (const chestLocation of chestLocations) {
    const dist = bot.entity.position.distanceTo(chestLocation)
    if (location == null || dist < distance) {
      location = chestLocation
      distance = dist
    }
  }
  return location
}
