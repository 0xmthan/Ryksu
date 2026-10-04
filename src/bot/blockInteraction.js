const { Vec3 } = require('vec3')
const { goals } = require('./plugins/core/pathfinder')
const INTERACTIVE = new Set(require('../shared/interactiveBlocks.json'))

const openInteractiveBlock = async (bot, position) => {
  if (!bot?.entity || !position || !['x', 'y', 'z'].every(key => Number.isInteger(position[key]))) {
    throw new Error('Invalid block position.')
  }
  if (bot.currentWindow) throw new Error('Close the current container first.')
  const target = new Vec3(position.x, position.y, position.z)
  let block = bot.blockAt(target)
  if (!block || !INTERACTIVE.has(block.name)) throw new Error('This block does not have a supported inventory.')
  if (bot.entity.position.distanceTo(target.offset(0.5, 0.5, 0.5)) > 3.5) {
    let timer
    try {
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalGetToBlock(target.x, target.y, target.z)),
        new Promise((_, reject) => { timer = setTimeout(() => {
          bot.pathfinder.setGoal(null)
          reject(new Error('Could not reach that block.'))
        }, 20000) }),
      ])
    } finally { clearTimeout(timer) }
  }
  block = bot.blockAt(target)
  if (!block || !INTERACTIVE.has(block.name)) throw new Error('That block is no longer available.')
  if (bot.entity.position.distanceTo(target.offset(0.5, 0.5, 0.5)) > 4.5) throw new Error('That block is out of reach.')
  // Register before activating: a blocked chest or protected block may never open.
  await new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      bot.removeListener('windowOpen', opened)
      bot.removeListener('end', ended)
    }
    const opened = () => { cleanup(); resolve() }
    const ended = () => { cleanup(); reject(new Error('Disconnected while opening the block.')) }
    bot.once('windowOpen', opened)
    bot.once('end', ended)
    timer = setTimeout(() => { cleanup(); reject(new Error('The block did not open. It may be blocked or protected.')) }, 5000)
    Promise.resolve().then(() => bot.activateBlock(block)).catch(error => { cleanup(); reject(error) })
  })
}
module.exports = { openInteractiveBlock }
