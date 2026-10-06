// What the watcher's first person view does with the mouse, the way the game does it: the bot looks where
// the camera looks, a left click swings (hitting what's in reach), holding it on a block digs it, and a
// right click places the held block. Nothing here walks: out of reach is out of reach.
import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { placeBlock, isPlaceable, isEmptySpace, findSupport } from '../actions/building'
import type { Vec3Like } from '../../../shared/ipc'

type ActionResult = { ok: boolean; message?: string }

// The game's reach: entities from the eyes, blocks from the eyes to the block's center.
const ENTITY_REACH = 3.5
const BLOCK_REACH = 4.5

export class FirstPersonActions {
  private isAutoToolEnabled: () => boolean
  private bot: Bot | null

  constructor({ isAutoToolEnabled }: { isAutoToolEnabled: () => boolean }) {
    this.isAutoToolEnabled = isAutoToolEnabled
    this.bot = null
  }

  attach(bot: Bot) {
    this.bot = bot
  }

  detach() {
    this.bot = null
  }

  private _eyes(bot: Bot) {
    const { entity } = bot
    return entity.position.offset(0, entity.eyeHeight ?? 1.62, 0)
  }

  look(yaw: number, pitch: number) {
    if (!this.bot?.entity || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return
    this.bot.look(yaw, pitch, true).catch(() => {})
  }

  // A left click: hits the entity if it's in reach, else just swings.
  hit(entityId: unknown): ActionResult {
    const bot = this.bot
    if (!bot?.entity) return { ok: false }
    const entity = Number.isInteger(entityId) ? bot.entities[entityId as number] : null
    if (entity?.isValid && entity !== bot.entity) {
      const middle = entity.position.offset(0, (entity.height ?? 1.8) / 2, 0)
      if (this._eyes(bot).distanceTo(middle) <= ENTITY_REACH + (entity.width ?? 0.6) / 2) {
        bot.attack(entity)
        return { ok: true }
      }
    }
    bot.swingArm('right')
    return { ok: true }
  }

  // Held left click on a block. Resolves when it breaks or digging stops.
  async dig(position: Vec3Like): Promise<ActionResult> {
    const bot = this.bot
    if (!bot?.entity) return { ok: false }
    const block = bot.blockAt(new Vec3(position.x, position.y, position.z))
    if (!block || isEmptySpace(block) || block.diggable === false || !(block.hardness >= 0)) {
      bot.swingArm('right')
      return { ok: false }
    }
    if (this._eyes(bot).distanceTo(block.position.offset(0.5, 0.5, 0.5)) > BLOCK_REACH) {
      bot.swingArm('right')
      return { ok: false, message: 'Too far away.' }
    }
    this.stopDig()
    if (this.isAutoToolEnabled() && bot.tool) {
      try {
        await bot.tool.equipForBlock(block, {})
      } catch {
        // Digging by hand still works.
      }
    }
    try {
      await bot.dig(block, true)
      return { ok: true }
    } catch {
      // Let go of the button, or the block changed.
      return { ok: false }
    }
  }

  stopDig() {
    if (this.bot?.targetDigBlock) this.bot.stopDigging()
  }

  // A right click on a block face with a block in hand. `replace`: the clicked block is grass, a fern or
  // the like, which the game swaps for the placed block instead of building against it.
  async place(position: Vec3Like, face: Vec3Like, replace = false): Promise<ActionResult> {
    const bot = this.bot
    if (!bot?.entity) return { ok: false }
    if (!isPlaceable(bot, bot.heldItem)) return { ok: false }
    const target = replace
      ? new Vec3(position.x, position.y, position.z)
      : new Vec3(position.x + face.x, position.y + face.y, position.z + face.z)
    if (this._eyes(bot).distanceTo(target.offset(0.5, 0.5, 0.5)) > BLOCK_REACH) {
      return { ok: false, message: 'Too far away.' }
    }
    const support = replace ? findSupport(bot, target, null) : { position, face }
    if (!support) return { ok: false, message: 'Nothing to place against there.' }
    try {
      await placeBlock(bot, support.position, support.face)
      bot.swingArm('right')
      return { ok: true }
    } catch (error) {
      return { ok: false, message: (error as Error | undefined)?.message || 'Could not place that.' }
    }
  }
}
