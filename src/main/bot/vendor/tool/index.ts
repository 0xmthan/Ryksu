import type { CoreBot } from '../types'
import { Tool } from './Tool'
import { pathfinder } from '../pathfinder'

export function plugin(bot: CoreBot) {
  setTimeout(() => {
    if (bot.pathfinder == null) bot.loadPlugin(pathfinder)
  }, 0)
  bot.tool = new Tool(bot)
}
