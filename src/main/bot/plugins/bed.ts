import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'
import { Vec3 } from 'vec3'
import type { PathfinderController } from './pathfinder'
import { isTrue } from '../../../shared/blocks'

export type BedResult = { sleeping: boolean; message: string }

const BED_SEARCH_RADIUS = 32
const SET_SPAWN_CONFIRM_TIMEOUT_MS = 3000
const PICKUP_CONFIRM_TIMEOUT_MS = 2000
const WAKE_CONFIRM_TIMEOUT_MS = 3000
const WAKE_ACTION_NAMES = ['stop_sleeping', 'leave_bed']
const PLACED_BED_TIMEOUT_MS = 2000
const SLEEP_RETRY_DELAY_MS = 1000

const SLEEP_ERROR_MESSAGES: Record<string, string> = {
  "it's not night and it's not a thunderstorm": 'You can only sleep at night or during a thunderstorm.',
  'there are monsters nearby': 'There are monsters nearby.',
  'the bed is occupied': 'That bed is occupied.',
  'the bed is too far': 'Could not get close enough to the bed.',
}

const HORIZONTAL_DIRECTIONS = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]

const isBedName = (name: unknown) => typeof name === 'string' && name.endsWith('_bed')

// Same window mineflayer's bot.sleep() accepts; outside it, using a bed only sets the spawn point.
export const canSleepNow = (bot: Bot) => {
  const thunderstorm = bot.isRaining && bot.thunderState > 0
  const timeOfDay = bot.time?.timeOfDay ?? 0
  return thunderstorm || (timeOfDay >= 12541 && timeOfDay <= 23458)
}

const waitForSetSpawnMessage = (bot: Bot) =>
  new Promise<boolean>((resolve) => {
    const handleMessage = (message: { translate?: string; toString?: () => string } | null) => {
      if (
        message?.translate === 'block.minecraft.set_spawn' ||
        /respawn point set/i.test(message?.toString?.() ?? '')
      ) {
        finish(true)
      }
    }
    const finish = (confirmed: boolean) => {
      clearTimeout(timeout)
      bot.removeListener('message', handleMessage as never)
      resolve(confirmed)
    }
    const timeout = setTimeout(() => finish(false), SET_SPAWN_CONFIRM_TIMEOUT_MS)
    bot.on('message', handleMessage as never)
  })

const toSleepError = (error: unknown) => {
  const message = (error as Error | undefined)?.message ?? ''
  return new Error(SLEEP_ERROR_MESSAGES[message] ?? (message || 'Could not sleep.'))
}

export class BedController {
  private pathfinder: PathfinderController
  private isFollowing: () => boolean
  private bot: Bot | null
  private placedBed: Vec3 | null
  private pickupPending: boolean

  constructor({ pathfinder, isFollowing }: { pathfinder: PathfinderController; isFollowing: () => boolean }) {
    this.pathfinder = pathfinder
    this.isFollowing = isFollowing
    this.bot = null
    // Bed the bot placed itself, so it can offer to pick it back up after waking.
    this.placedBed = null
    this.pickupPending = false
    this._handleWake = this._handleWake.bind(this)
  }

  attach(bot: Bot) {
    this.bot = bot
    this.placedBed = null
    this.pickupPending = false
    bot.on('wake', this._handleWake)
  }

  detach() {
    this.bot?.removeListener('wake', this._handleWake)
    this.bot = null
    this.placedBed = null
    this.pickupPending = false
  }

  getState() {
    const bot = this.bot
    return {
      isSleeping: Boolean(bot?.isSleeping),
      canSleep: bot ? canSleepNow(bot) : false,
      bedPickupPending: this.pickupPending && !bot?.isSleeping,
    }
  }

  async useNearestBed(): Promise<BedResult> {
    const bot = this._requireBot()

    if (bot.isSleeping) {
      await this._wake()
      return { sleeping: false, message: 'Woke up.' }
    }

    if (this.isFollowing()) {
      throw new Error('Turn off Follow before using a bed.')
    }

    // A new attempt replaces any pick-up question; it comes back when the bot wakes up.
    this.pickupPending = false

    const beds = this._nearbyBeds()
    // At night only a free bed is useful; during the day any bed sets the spawn point.
    const bed = canSleepNow(bot) ? beds.find((block) => !this._isOccupied(block)) : beds[0]
    if (!bed) {
      if (this._bedItem()) {
        return canSleepNow(bot) ? this._placeBedAndSleep() : this._placeBedAndSetSpawn()
      }
      throw new Error(
        beds.length ? 'Every bed nearby is occupied.' : `No bed within ${BED_SEARCH_RADIUS} blocks.`
      )
    }

    try {
      await this.pathfinder.goNear(bed.position, 2)
    } catch {
      throw new Error('Could not reach the bed.')
    }

    // Checked after walking, since night may have started (or ended) on the way.
    if (!canSleepNow(bot)) {
      const confirmed = await this._setSpawnAt(bed)
      return {
        sleeping: false,
        message: confirmed
          ? 'Spawn point set.'
          : 'Used the bed, but the server did not confirm the spawn point.',
      }
    }

    try {
      await bot.sleep(bot.blockAt(bed.position) ?? bed)
    } catch (error) {
      // Someone got into the bed while the bot was walking there.
      if ((error as Error | undefined)?.message === 'the bed is occupied' && this._bedItem()) {
        return this._placeBedAndSleep()
      }
      throw toSleepError(error)
    }

    return { sleeping: true, message: 'Sleeping. Spawn point set.' }
  }

  async pickUpPlacedBed(): Promise<{ message: string }> {
    const bot = this._requireBot()
    const placed = this.placedBed
    this.pickupPending = false
    if (!placed) {
      throw new Error('There is no placed bed to pick up.')
    }
    this.placedBed = null

    const block = bot.blockAt(placed)
    if (!block || !isBedName(block.name)) {
      throw new Error('The bed is no longer there.')
    }

    const bedsBefore = this._countBeds()
    try {
      await this.pathfinder.goNear(placed, 2)
      await bot.dig(block)
      // Stand where the bed was so the dropped item gets collected.
      await this.pathfinder.goNear(placed, 0)
    } catch {
      throw new Error('Could not pick up the bed.')
    }

    const collected = await this._waitFor(() => this._countBeds() > bedsBefore, PICKUP_CONFIRM_TIMEOUT_MS)
    return { message: collected ? 'Picked up the bed.' : 'Broke the bed, but did not collect it.' }
  }

  dismissPickup() {
    this.pickupPending = false
    this.placedBed = null
  }

  private async _setSpawnAt(bed: Block) {
    const bot = this._requireBot()
    const confirmation = waitForSetSpawnMessage(bot)
    await bot.activateBlock(bed)
    return confirmation
  }

  private async _placeBedAndSleep(): Promise<BedResult> {
    const foot = await this._placeBed()

    try {
      await this._sleepWithRetry(foot)
    } catch (error) {
      // The bot won't sleep in it, so offer to pick it back up now.
      this.pickupPending = true
      throw toSleepError(error)
    }

    return { sleeping: true, message: 'Placed a bed and went to sleep.' }
  }

  // During the day a bed only sets the spawn point. The bed stays put, since breaking it would clear that spawn.
  private async _placeBedAndSetSpawn(): Promise<BedResult> {
    const foot = await this._placeBed()
    const bed = this._requireBot().blockAt(foot)
    let confirmed = false
    try {
      confirmed = await this._setSpawnAt(bed!)
    } catch {
      this.pickupPending = true
      throw new Error('Placed a bed, but could not use it.')
    }
    this.placedBed = null
    return {
      sleeping: false,
      message: confirmed
        ? 'Placed a bed and set the spawn point there.'
        : 'Placed a bed and used it, but the server did not confirm the spawn point.',
    }
  }

  private async _placeBed() {
    const bot = this._requireBot()
    const spot = this._findPlacementSpot()
    if (!spot) {
      throw new Error('No room to place a bed here (needs 2 flat blocks next to the bot).')
    }

    try {
      await bot.equip(this._bedItem()!, 'hand')
      // The bed's head extends the way the bot faces; placing on the floor block looks straight along `spot.direction`.
      await bot.placeBlock(bot.blockAt(spot.foot.offset(0, -1, 0))!, new Vec3(0, 1, 0))
    } catch {
      throw new Error('Could not place the bed.')
    }

    // The server sends the head half a moment after the foot; mineflayer refuses to sleep in half a bed.
    const head = spot.foot.plus(spot.direction)
    const complete = await this._waitFor(
      () => isBedName(bot.blockAt(spot.foot)?.name) && isBedName(bot.blockAt(head)?.name),
      PLACED_BED_TIMEOUT_MS
    )
    if (!isBedName(bot.blockAt(spot.foot)?.name)) {
      throw new Error('Could not place the bed.')
    }
    this.placedBed = spot.foot
    if (!complete) {
      this.pickupPending = true
      throw new Error('Placed the bed, but it did not finish appearing.')
    }
    return spot.foot
  }

  private async _sleepWithRetry(position: Vec3) {
    try {
      const bot = this._requireBot()
      await bot.sleep(bot.blockAt(position)!)
    } catch (error) {
      if (SLEEP_ERROR_MESSAGES[(error as Error | undefined)?.message ?? '']) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, SLEEP_RETRY_DELAY_MS))
      if (!this.bot) {
        throw error
      }
      await this.bot.sleep(this.bot.blockAt(position)!)
    }
  }

  // mineflayer's bot.wake() sends entity_action id 2, which hasn't been "leave bed" since 1.21.6 and is rejected by
  // the newer name-based mapping, so look the action up by name when the protocol has one.
  private async _wake() {
    const bot = this._requireBot()
    const protocol = bot.registry.protocol as unknown as
      | { play?: { toServer?: { types?: Record<string, [string, { name: string; type: unknown }[]]> } } }
      | undefined
    const actionType = protocol?.play?.toServer?.types?.packet_entity_action?.[1]?.find(
      (field) => field.name === 'actionId'
    )?.type
    const mappings =
      Array.isArray(actionType) && actionType[0] === 'mapper'
        ? Object.values((actionType[1] as { mappings: Record<string, string> }).mappings)
        : []
    const wakeAction = WAKE_ACTION_NAMES.find((name) => mappings.includes(name))

    const woke = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        bot.removeListener('wake', handleWake)
        resolve(false)
      }, WAKE_CONFIRM_TIMEOUT_MS)
      const handleWake = () => {
        clearTimeout(timeout)
        resolve(true)
      }
      bot.once('wake', handleWake)
    })

    if (wakeAction) {
      bot._client.write('entity_action', { entityId: bot.entity.id, actionId: wakeAction, jumpBoost: 0 })
    } else {
      await bot.wake()
    }

    if (!(await woke)) {
      throw new Error('The server did not let the bot out of bed.')
    }
  }

  private _findPlacementSpot() {
    const bot = this._requireBot()
    const origin = bot.entity.position.floored()
    const isAir = (pos: Vec3) => bot.blockAt(pos)?.boundingBox === 'empty'
    const isFloor = (pos: Vec3) => bot.blockAt(pos)?.boundingBox === 'block'
    const isFree = (pos: Vec3) => isAir(pos) && isAir(pos.offset(0, 1, 0)) && isFloor(pos.offset(0, -1, 0))

    for (const direction of HORIZONTAL_DIRECTIONS) {
      const foot = origin.plus(direction)
      const head = foot.plus(direction)
      if (isFree(foot) && isFree(head)) {
        return { foot, direction }
      }
    }
    return null
  }

  private _handleWake() {
    if (this.placedBed) {
      this.pickupPending = true
    }
  }

  private _nearbyBeds() {
    const bot = this._requireBot()
    return bot
      .findBlocks({ matching: this._bedBlockIds(), maxDistance: BED_SEARCH_RADIUS, count: 32 })
      .map((position) => bot.blockAt(position))
      .filter((block): block is Block => Boolean(block))
  }

  private _isOccupied(block: Block) {
    try {
      const occupied = block.getProperties?.().occupied
      if (occupied !== undefined) {
        return isTrue(occupied)
      }
      return Boolean(this._requireBot().parseBedMetadata(block)?.occupied)
    } catch {
      return false
    }
  }

  private _bedBlockIds() {
    return Object.values(this._requireBot().registry.blocksByName)
      .filter((block) => isBedName(block.name))
      .map((block) => block.id)
  }

  private _bedItem() {
    return (
      this._requireBot()
        .inventory.items()
        .find((item) => isBedName(item.name)) ?? null
    )
  }

  private _countBeds() {
    return this._requireBot()
      .inventory.items()
      .filter((item) => isBedName(item.name))
      .reduce((total, item) => total + item.count, 0)
  }

  private _waitFor(check: () => boolean, timeoutMs: number) {
    return new Promise<boolean>((resolve) => {
      const started = Date.now()
      const poll = setInterval(() => {
        if (check() || Date.now() - started >= timeoutMs) {
          clearInterval(poll)
          resolve(check())
        }
      }, 100)
    })
  }

  private _requireBot() {
    if (!this.bot) {
      throw new Error('The bot is not connected.')
    }
    return this.bot
  }
}
