// Opening (or closing) a door the bot was sent to: polls while it walks there, and toggles the door once it's
// within reach, unless someone else got to it first.
import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { Vec3Like } from '../ipc'
import { isTrue } from '../shared/blockProps'

const POLL_MS = 100
const GIVE_UP_MS = 30000
// Player reach is 4.5; within 3.5 blocks the bot can interact with the door without crowding it.
const DOOR_REACH = 3.5

type Operation = {
  aborted: boolean
  interval: ReturnType<typeof setInterval> | null
  timeout: ReturnType<typeof setTimeout> | null
}

const isDoorBlock = (name: unknown): name is string =>
  typeof name === 'string' &&
  (name.endsWith('_door') || name === 'door' || name === 'wooden_door') &&
  !name.endsWith('trapdoor')

export class DoorOpener {
  private getBot: () => Bot | null
  private onNotice: (text: string) => void
  private operation: Operation | null = null

  constructor({ getBot, onNotice }: { getBot: () => Bot | null; onNotice: (text: string) => void }) {
    this.getBot = getBot
    this.onNotice = onNotice
  }

  cancel() {
    const op = this.operation
    if (!op) return
    op.aborted = true
    if (op.interval) clearInterval(op.interval)
    if (op.timeout) clearTimeout(op.timeout)
    this.operation = null
  }

  // Toggles the door (opens if closed, closes if open) as soon as the bot gets within reach.
  schedule(doorLocation: Vec3Like) {
    this.cancel()

    const pos = new Vec3(Math.floor(doorLocation.x), Math.floor(doorLocation.y), Math.floor(doorLocation.z))
    const initialBlock = this.getBot()?.blockAt(pos)
    const wasOpen = isTrue(
      typeof initialBlock?.getProperties === 'function' ? initialBlock.getProperties().open : undefined
    )

    const op: Operation = { aborted: false, interval: null, timeout: null }
    this.operation = op

    // Also stops the polling for good: the first check can toggle before the interval below exists.
    const cleanup = () => {
      op.aborted = true
      if (op.interval) clearInterval(op.interval)
      if (op.timeout) clearTimeout(op.timeout)
      if (this.operation === op) {
        this.operation = null
      }
    }

    const tryToggle = async () => {
      const bot = this.getBot()
      if (op.aborted || !bot?.entity) {
        cleanup()
        return
      }

      const block = bot.blockAt(pos)
      if (!block || !isDoorBlock(block.name)) {
        cleanup()
        return
      }

      if (block.name.includes('iron')) {
        this.onNotice('Iron doors cannot be opened by hand.')
        cleanup()
        return
      }

      const props = typeof block.getProperties === 'function' ? block.getProperties() : {}

      // If the door already changed its state, we're done.
      if (isTrue(props.open) !== wasOpen) {
        cleanup()
        return
      }

      const lowerPos = props.half === 'upper' ? pos.offset(0, -1, 0) : pos
      const doorCenter = lowerPos.offset(0.5, 0.5, 0.5)
      const distance = bot.entity.position.offset(0, 1.6, 0).distanceTo(doorCenter)
      if (distance > DOOR_REACH) return

      cleanup()
      try {
        bot.pathfinder?.stop()
        bot.pathfinder?.setGoal(null)
      } catch {}

      const doorBlock = bot.blockAt(lowerPos) || block
      try {
        await bot.lookAt(doorCenter)
        await bot.activateBlock(doorBlock)
        this.onNotice(`${wasOpen ? 'Closed' : 'Opened'} ${doorBlock.displayName ?? doorBlock.name}.`)
      } catch (error) {
        console.error(`[DoorOpener] Failed to ${wasOpen ? 'close' : 'open'} door`, error)
        this.onNotice(`Could not ${wasOpen ? 'close' : 'open'} the door.`)
      }
    }

    // Poll while walking towards the door, after one try in case the bot is already close to it.
    op.interval = setInterval(tryToggle, POLL_MS)
    op.timeout = setTimeout(cleanup, GIVE_UP_MS)
    tryToggle()
  }
}
