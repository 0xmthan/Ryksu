import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import interactiveBlocks from '../shared/interactiveBlocks.json'
import { goals } from './plugins/core/pathfinder'

const INTERACTIVE = new Set<string>(interactiveBlocks)

export const openInteractiveBlock = async (bot: Bot, position: { x: number; y: number; z: number }) => {
  if (
    !bot?.entity ||
    !position ||
    !(['x', 'y', 'z'] as const).every((key) => Number.isInteger(position[key]))
  ) {
    throw new Error('Invalid block position.')
  }
  if (bot.currentWindow) throw new Error('Close the current container first.')
  const target = new Vec3(position.x, position.y, position.z)
  let block = bot.blockAt(target)
  if (!block || !INTERACTIVE.has(block.name))
    throw new Error('This block does not have a supported inventory.')
  if (bot.entity.position.distanceTo(target.offset(0.5, 0.5, 0.5)) > 3.5) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalGetToBlock(target.x, target.y, target.z)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            bot.pathfinder.setGoal(null)
            reject(new Error('Could not reach that block.'))
          }, 20000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  block = bot.blockAt(target)
  if (!block || !INTERACTIVE.has(block.name)) throw new Error('That block is no longer available.')
  if (bot.entity.position.distanceTo(target.offset(0.5, 0.5, 0.5)) > 4.5)
    throw new Error('That block is out of reach.')
  // Register before activating: a blocked chest or protected block may never open.
  const opening = block
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      bot.removeListener('windowOpen', opened)
      bot.removeListener('end', ended)
    }
    const opened = () => {
      cleanup()
      resolve()
    }
    const ended = () => {
      cleanup()
      reject(new Error('Disconnected while opening the block.'))
    }
    bot.once('windowOpen', opened)
    bot.once('end', ended)
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('The block did not open. It may be blocked or protected.'))
    }, 5000)
    Promise.resolve()
      .then(() => bot.activateBlock(opening))
      .catch((error) => {
        cleanup()
        reject(error)
      })
  })
}
