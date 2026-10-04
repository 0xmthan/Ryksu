const { Tool } = require('./Tool')
const { pathfinder } = require('../pathfinder')

function plugin(bot) {
  setTimeout(() => {
    if (bot.pathfinder == null) bot.loadPlugin(pathfinder)
  }, 0)
  bot.tool = new Tool(bot)
}

module.exports = { plugin, Tool }
