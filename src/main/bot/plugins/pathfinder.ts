import type { Bot } from 'mineflayer'
import type { Entity } from 'prismarine-entity'
import type { PathfinderOptions } from '../../../shared/types'
import { pathfinder as pathfinderPlugin, Movements, goals } from '../vendor/pathfinder'
import type { Goal } from '../vendor/pathfinder/lib/goals'
import { isOpenDoorway } from '../vendor/pathfinder/lib/movements'
import { applyBlockEditing } from './blockEditing'

type FollowOptions = Pick<PathfinderOptions, 'followEnabled' | 'followTarget'>
type GoToLocation = NonNullable<PathfinderOptions['goToLocation']>
type GoToRun = {
  target: { x: number; y: number; z: number }
  goal: Goal | null
  promise: Promise<unknown> | null
}

// The pathfinder picks walk / sprint / sprint-jump each tick by simulating ahead. Coming into a doorway
// slightly off-center, the walk simulation clips the door panel and it falls back to jumping, which a
// two-high door never needs. Runs right after the pathfinder sets its controls and calls the jump off
// (and the sprint, which overshoots the turn into the door) while an open doorway is right there, unless
// a real step up is directly ahead.
const DOORWAY_REACH = 1.6

const nearOpenDoorway = (bot: Bot) => {
  const feet = bot.entity.position.floored()
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const block = bot.blockAt(feet.offset(dx, 0, dz))
      if (!block || !isOpenDoorway(block)) continue
      const center = block.position.offset(0.5, 0, 0.5)
      if (Math.hypot(center.x - bot.entity.position.x, center.z - bot.entity.position.z) <= DOORWAY_REACH)
        return true
    }
  }
  return false
}

const stepAhead = (bot: Bot) => {
  const yaw = bot.entity.yaw
  const ahead = bot.entity.position.offset(-Math.sin(yaw) * 0.8, 0, -Math.cos(yaw) * 0.8).floored()
  const block = bot.blockAt(ahead)
  return Boolean(block && block.boundingBox === 'block' && !isOpenDoorway(block))
}

const smoothDoorways = (bot: Bot) => () => {
  if (!bot.entity || !bot.pathfinder?.isMoving?.() || bot.entity.isInWater) return
  if (!bot.getControlState('jump') && !bot.getControlState('sprint')) return
  if (!nearOpenDoorway(bot) || stepAhead(bot)) return
  bot.setControlState('jump', false)
  bot.setControlState('sprint', false)
}

export class PathfinderController {
  private bot: Bot | null
  private options: FollowOptions
  private movements: Movements | null
  private spawnListener: (() => void) | null
  private followInterval: ReturnType<typeof setInterval> | null
  private activeGoTo: GoToRun | null
  private allowBlockBreak: boolean
  private followPausedUntil: number
  private followedEntity: Entity | null
  private doorwayListener?: (() => void) | null

  constructor() {
    this.bot = null
    this.options = { followEnabled: false, followTarget: '' }
    this.movements = null
    this.spawnListener = null
    this.followInterval = null
    this.activeGoTo = null
    this.allowBlockBreak = true
    this.followPausedUntil = 0
    this.followedEntity = null
  }

  attach(bot: Bot) {
    this.bot = bot
    this._ensurePlugin()
    // After _ensurePlugin, so it runs after the pathfinder's own tick handler.
    if (this.doorwayListener) bot.removeListener('physicsTick', this.doorwayListener)
    this.doorwayListener = smoothDoorways(bot)
    bot.on('physicsTick', this.doorwayListener)

    if (this.options.followEnabled) {
      this._startFollowing()
    }
  }

  detach() {
    if (this.doorwayListener) this.bot?.removeListener('physicsTick', this.doorwayListener)
    this.doorwayListener = null
    this.followedEntity = null
    this._stopFollowing()
    this.movements = null
    this.bot = null
  }

  setBlockBreakingAllowed(allowed: boolean) {
    this.allowBlockBreak = Boolean(allowed)
    if (this.movements) {
      applyBlockEditing(this.movements, this.allowBlockBreak)
    }
    return this.allowBlockBreak
  }

  getOptions(): FollowOptions {
    return { ...this.options }
  }

  setOptions(options: Partial<PathfinderOptions> = {}): FollowOptions {
    const followEnabled =
      typeof options.followEnabled === 'boolean' ? options.followEnabled : this.options.followEnabled

    const followTarget =
      typeof options.followTarget === 'string' ? options.followTarget.trim() : this.options.followTarget

    const cancelGoTo = options.cancelGoTo === true
    const goToRequested = options.goToLocation && typeof options.goToLocation === 'object'
    if (!followEnabled || followTarget !== this.options.followTarget || goToRequested || cancelGoTo) {
      this.followedEntity = null
    }

    this.options = {
      ...this.options,
      followEnabled,
      followTarget,
    }

    if (cancelGoTo) {
      this._cancelGoTo()
    }

    // If a goToLocation is provided it's a one-shot command.
    if (goToRequested) {
      this._activateGoTo(options.goToLocation as GoToLocation)
    }

    if (!this.bot) {
      return this.getOptions()
    }

    if (this.options.followEnabled) {
      this._startFollowing()
    } else {
      this._stopFollowing({ preserveGoTo: Boolean(this.activeGoTo) })
    }

    return this.getOptions()
  }

  // Let another behavior (e.g. fleeing a creeper) drive the bot for a moment without follow overriding it.
  pauseFollow(ms: number) {
    this.followPausedUntil = Date.now() + ms
  }

  resumeFollow() {
    this.followPausedUntil = 0
    this._applyFollowGoal()
  }

  setTemporaryGoal(goal: Goal) {
    if (!this.bot || !this._ensurePlugin()) {
      return false
    }
    this._cancelGoTo()
    this.bot.pathfinder.setMovements(this.movements!)
    this.bot.pathfinder.setGoal(goal, true)
    return true
  }

  clearTemporaryGoal() {
    this.bot?.pathfinder?.setGoal(null)
  }

  goNear(position: { x: number; y: number; z: number }, range: number) {
    return this.goto(new goals.GoalNear(position.x, position.y, position.z, range))
  }

  goto(goal: Goal) {
    if (!this.bot || !this._ensurePlugin()) {
      return Promise.reject(new Error('Pathfinder is not available.'))
    }

    this._cancelGoTo()
    this.bot.pathfinder.setMovements(this.movements!)
    return this.bot.pathfinder.goto(goal)
  }

  _ensurePlugin() {
    if (!this.bot) {
      return false
    }

    if (!this.bot.pathfinder) {
      try {
        this.bot.loadPlugin(pathfinderPlugin)
      } catch (error) {
        console.error('[Pathfinder] Failed to load pathfinder plugin', error)
        return false
      }
    }

    if (!this.movements && this.bot.pathfinder) {
      this.movements = new Movements(this.bot)
    }

    if (this.movements) {
      applyBlockEditing(this.movements, this.allowBlockBreak)
    }

    if (this.bot.pathfinder) {
      this.bot.pathfinder.thinkTimeout = 10000
    }

    return Boolean(this.bot.pathfinder)
  }

  private _startFollowing() {
    if (!this._ensurePlugin()) {
      return
    }

    if (!this.spawnListener) {
      this.spawnListener = () => {
        this._applyFollowGoal()
      }
      this.bot!.on('spawn', this.spawnListener)
    }

    if (!this.followInterval) {
      this.followInterval = setInterval(() => {
        this._applyFollowGoal()
      }, 2000)
    }

    this._applyFollowGoal()
  }

  private _stopFollowing({ preserveGoTo = false } = {}) {
    if (this.followInterval) {
      clearInterval(this.followInterval)
      this.followInterval = null
    }

    if (this.spawnListener && this.bot) {
      this.bot.removeListener('spawn', this.spawnListener)
      this.spawnListener = null
    }

    if (this.bot?.pathfinder) {
      if (preserveGoTo && this.activeGoTo) {
        return
      }

      this._clearGoal()
    }
  }

  _applyFollowGoal() {
    if (!this.bot?.pathfinder || !this.options.followEnabled || Date.now() < this.followPausedUntil) {
      return
    }

    const targetName = this.options.followTarget.trim()
    if (!targetName) {
      this.bot.pathfinder.setGoal(null)
      return
    }

    const entity = this.followedEntity ?? this.bot.players?.[targetName]?.entity
    if (!entity || entity.isValid === false) {
      this.bot.pathfinder.setGoal(null)
      return
    }

    if (!this.movements) {
      this.movements = new Movements(this.bot)
    }
    if (this.movements) {
      applyBlockEditing(this.movements, this.allowBlockBreak)
    }

    try {
      this.bot.pathfinder.setMovements(this.movements)
    } catch (error) {
      console.error('[Pathfinder] Failed to set pathfinder movements', error)
      return
    }

    const currentGoal = this.bot.pathfinder.goal as (Goal & { player?: Entity; entity?: Entity }) | null
    if (
      currentGoal &&
      ((currentGoal.player && currentGoal.player === entity) ||
        (currentGoal.entity && currentGoal.entity === entity))
    ) {
      return
    }

    try {
      this.bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true)
    } catch (error) {
      console.error('[Pathfinder] Failed to set follow goal', error)
    }
  }

  followEntity(entity: Entity) {
    this.followedEntity = entity
    this._applyFollowGoal()
  }

  private _isRecoverablePathError(error: unknown) {
    if (!error) {
      return false
    }

    const raw = (error as { message?: unknown }).message
    const message = typeof raw === 'string' ? raw.toLowerCase() : ''
    if (!message && typeof error === 'string') {
      return error.toLowerCase().includes('no path')
    }

    return (
      message.includes('no path') ||
      message.includes('unreachable') ||
      message.includes('path could not be found') ||
      message.includes('took to long') ||
      message.includes('timeout')
    )
  }

  private _activateGoTo(location: GoToLocation) {
    if (!this.bot || !this._ensurePlugin()) {
      return
    }

    const { x, y, z } = location
    if (![x, y, z].every((coord) => typeof coord === 'number' && Number.isFinite(coord))) {
      return
    }

    const target = {
      x: Math.floor(x),
      y: Math.floor(y),
      z: Math.floor(z),
    }

    if (!this.movements) {
      this.movements = new Movements(this.bot)
    }
    if (this.movements) {
      applyBlockEditing(this.movements, this.allowBlockBreak)
    }

    this._cancelGoTo()

    const door = location.door && typeof location.door === 'object' ? location.door : null
    const doorPos = door
      ? {
          x: Math.floor(door.x),
          y: Math.floor(door.y),
          z: Math.floor(door.z),
        }
      : null

    const goalsToTry: { label: string; goal: Goal }[] = doorPos
      ? [
          { label: 'door reach radius 2.6', goal: new goals.GoalNear(doorPos.x, doorPos.y, doorPos.z, 2.6) },
          { label: 'door reach radius 3', goal: new goals.GoalNear(doorPos.x, doorPos.y, doorPos.z, 3) },
          { label: 'near target radius 2', goal: new goals.GoalNear(target.x, target.y, target.z, 2) },
        ]
      : [
          { label: 'exact block', goal: new goals.GoalBlock(target.x, target.y, target.z) },
          { label: 'near radius 1', goal: new goals.GoalNear(target.x, target.y, target.z, 1) },
          { label: 'near radius 2', goal: new goals.GoalNear(target.x, target.y, target.z, 2) },
          { label: 'near radius 4', goal: new goals.GoalNear(target.x, target.y, target.z, 4) },
          { label: 'same column', goal: new goals.GoalXZ(target.x, target.z) },
        ]

    this._stopFollowing({ preserveGoTo: false })

    const bot = this.bot
    try {
      bot.pathfinder.setMovements(this.movements!)
    } catch (error) {
      console.error('[Pathfinder] Failed to set movements before go-to', error)
      return
    }

    // This go-to's own record; a newer go-to replaces it, and then this one must leave everything alone
    // (its promise fails with GoalChanged as the new goal takes over).
    const run: GoToRun = { target, goal: null, promise: null }
    const isCurrent = () => this.activeGoTo === run

    const attemptGoal = (index: number): Promise<unknown> => {
      if (!isCurrent()) {
        return Promise.resolve()
      }

      if (index >= goalsToTry.length) {
        this.activeGoTo = null
        return Promise.reject(new Error('Unable to reach target location.'))
      }

      const { goal } = goalsToTry[index]
      run.goal = goal

      return bot.pathfinder.goto(goal).catch((error) => {
        if (!isCurrent() || run.goal !== goal) {
          return Promise.reject(error)
        }

        if (error?.name === 'GoalChanged' || error?.code === 'GoalChanged') {
          this.activeGoTo = null
          return Promise.reject(error)
        }

        if (this._isRecoverablePathError(error)) {
          try {
            bot.pathfinder.stop()
          } catch {
            // ignore stop errors when recovering
          }
          return attemptGoal(index + 1)
        }

        console.error('[Pathfinder] Go-to failed', error)
        this.activeGoTo = null
        return Promise.reject(error)
      })
    }

    this.activeGoTo = run

    run.promise = new Promise((resolve, reject) => {
      // Only the go-to that's still current cleans up; a replaced one would stop its successor.
      const finish = () => {
        if (!isCurrent()) return false
        this.activeGoTo = null
        this.bot?.pathfinder?.setGoal(null)
        return true
      }
      attemptGoal(0)
        .then((result) => {
          finish()
          resolve(result)
        })
        .catch((error) => {
          finish()
          reject(error)
        })
    })
    // Failures are expected (replaced, unreachable); nothing waits on this.
    run.promise.catch(() => {})
  }

  private _cancelGoTo() {
    if (!this.activeGoTo) {
      return
    }

    try {
      if (this.bot?.pathfinder) {
        this.bot.pathfinder.stop()
        this.bot.pathfinder.setGoal(null)
      }
    } catch (error) {
      console.error('[Pathfinder] Failed to stop pathfinder during cancel', error)
    } finally {
      this.activeGoTo = null
    }
  }

  private _clearGoal() {
    if (!this.bot?.pathfinder) {
      this.activeGoTo = null
      return
    }

    this.activeGoTo = null

    try {
      const hasEntityVelocity = Boolean(this.bot.entity?.velocity)
      if (hasEntityVelocity) {
        this.bot.pathfinder.stop()
      }
      this.bot.pathfinder.setGoal(null)
    } catch (error) {
      console.error('[Pathfinder] Failed to clear pathfinder goal', error)
    }
  }
}
