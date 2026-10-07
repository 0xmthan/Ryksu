import type { Bot } from 'mineflayer'
import type { Entity } from 'prismarine-entity'
import type { PathfinderOptions } from '../../../shared/types'
import { pathfinder as pathfinderPlugin, Movements, goals } from '../vendor/pathfinder'
import type { Goal } from '../vendor/pathfinder/lib/goals'
import { isOpenDoorway } from '../vendor/pathfinder/lib/movements'
import { applyBlockEditing } from './blockEditing'
import { GoalAbove, avoidBigCaves, hasSkyAbove } from './caves'

type FollowOptions = Pick<PathfinderOptions, 'followEnabled' | 'followTarget'>
type GoToLocation = NonNullable<PathfinderOptions['goToLocation']>
// Per-call overrides for goto: other movements (e.g. mining's), and a shorter, lighter search.
type GotoOptions = { movements?: Movements; thinkTimeout?: number; tickTimeout?: number }
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

// Go-to legs (see _travel). Searches are kept short and light: a long one stalls the bot and lags the app.
const CLIMB_MARGIN = 4
const CLIMB_STEP = 6
const CLIMB_THINK_MS = 3000
const HOP_DISTANCE = 48
const HOP_RANGE = 4
const HOP_THINK_MS = 5000
const ARRIVE_THINK_MS = 5000
const MAX_MISSES = 4
const TRAVEL_TICK_TIMEOUT_MS = 20
const DEFAULT_TICK_TIMEOUT_MS = 40
// Not getting anywhere this long mid-leg means the walk has stalled. Only moving, digging or a pause (eating)
// counts: a bot that keeps "building" without rising (jumping into a ceiling, say) is as stuck as one standing
// still.
const STALL_MS = 5000

export const watchStall = (bot: Bot, reject: (error: Error) => void, stallMs = STALL_MS) => {
  let lastActive = Date.now()
  let lastPosition = bot.entity?.position.clone()
  const timer = setInterval(() => {
    const position = bot.entity?.position
    const moved = position && lastPosition && position.distanceTo(lastPosition) > 0.2
    if (moved || bot.pathfinder?.isMining?.() || bot.pathfinder?.isPaused?.()) {
      lastActive = Date.now()
      if (position) lastPosition = position.clone()
    } else if (Date.now() - lastActive > stallMs) {
      clearInterval(timer)
      reject(new Error('Stalled.'))
    }
  }, 500)
  return () => clearInterval(timer)
}

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

  private isPaused: () => boolean

  // `isPaused`: the bot's hands are needed elsewhere for a moment (eating); walking waits.
  constructor({ isPaused = () => false }: { isPaused?: () => boolean } = {}) {
    this.isPaused = isPaused
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

  isBlockBreakingAllowed() {
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

  goto(goal: Goal, { movements, thinkTimeout, tickTimeout }: GotoOptions = {}) {
    if (!this.bot || !this._ensurePlugin()) {
      return Promise.reject(new Error('Pathfinder is not available.'))
    }

    this._cancelGoTo()
    const pathfinder = this.bot.pathfinder
    pathfinder.setMovements(movements ?? this.movements!)
    if (thinkTimeout === undefined && tickTimeout === undefined) {
      return pathfinder.goto(goal)
    }
    const previousTick = pathfinder.tickTimeout
    if (thinkTimeout !== undefined) pathfinder.thinkTimeout = thinkTimeout
    if (tickTimeout !== undefined) pathfinder.tickTimeout = tickTimeout
    return pathfinder.goto(goal).finally(() => {
      pathfinder.thinkTimeout = 10000
      pathfinder.tickTimeout = previousTick
    })
  }

  private _createMovements(bot: Bot) {
    const movements = new Movements(bot)
    avoidBigCaves(movements, bot)
    return movements
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
      this.movements = this._createMovements(this.bot)
    }

    if (this.movements) {
      applyBlockEditing(this.movements, this.allowBlockBreak)
    }

    if (this.bot.pathfinder) {
      this.bot.pathfinder.thinkTimeout = 10000
      this.bot.pathfinder.isPaused = this.isPaused
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
      this.movements = this._createMovements(this.bot)
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

    this._cancelGoTo()

    const door = location.door && typeof location.door === 'object' ? location.door : null
    const doorPos = door
      ? {
          x: Math.floor(door.x),
          y: Math.floor(door.y),
          z: Math.floor(door.z),
        }
      : null

    // Where "there" is: next to the door when going through one, else the spot itself or close to it.
    const arrivals: Goal[] = doorPos
      ? [
          new goals.GoalNear(doorPos.x, doorPos.y, doorPos.z, 2.6),
          new goals.GoalNear(doorPos.x, doorPos.y, doorPos.z, 3),
          new goals.GoalNear(target.x, target.y, target.z, 2),
        ]
      : [
          new goals.GoalBlock(target.x, target.y, target.z),
          new goals.GoalNear(target.x, target.y, target.z, 2),
        ]

    this._stopFollowing({ preserveGoTo: false })

    // This go-to's own record; a newer go-to replaces it, and then this one must leave everything alone.
    const run: GoToRun = { target, goal: null, promise: null }
    const isCurrent = () => this.activeGoTo === run
    this.activeGoTo = run

    run.promise = this._travel(run, isCurrent, arrivals).then(
      () => this._finishGoTo(run),
      (error) => {
        if (this._finishGoTo(run)) console.error('[Pathfinder] Go-to failed', error)
        throw error
      }
    )
    // Failures are expected (replaced, unreachable); nothing waits on this.
    run.promise.catch(() => {})
  }

  // Only the go-to that's still current cleans up; a replaced one would stop its successor.
  private _finishGoTo(run: GoToRun) {
    if (this.activeGoTo !== run) return false
    this.activeGoTo = null
    const pathfinder = this.bot?.pathfinder
    if (pathfinder) {
      pathfinder.setGoal(null)
      pathfinder.tickTimeout = DEFAULT_TICK_TIMEOUT_MS
    }
    return true
  }

  // A trip in legs. Deep underground below the target, it climbs first: up a passage if there's one close by,
  // else straight up through the rock, a block placed under it each step. Far away, it hops toward the target
  // a stretch at a time, so no single search has to plan the whole way (searching that far is slow and lags
  // everything). Close by, it heads for the spot itself. A leg that finds no way just leads to the next try.
  private async _travel(run: GoToRun, isCurrent: () => boolean, arrivals: Goal[]) {
    const bot = this.bot!
    const { target } = run
    const game = bot.game as Bot['game'] & { minY?: number; height?: number }
    const worldTop = (game?.minY ?? 0) + (game?.height ?? 256)
    let misses = 0
    while (isCurrent()) {
      const feet = bot.entity.position
      const underRock = !hasSkyAbove((position) => bot.blockAt(position, false), feet, worldTop)
      const climbFirst = target.y - feet.y > CLIMB_MARGIN && underRock
      const away = Math.hypot(target.x - feet.x, target.z - feet.z)

      if (climbFirst) {
        const goal = new GoalAbove(Math.min(Math.floor(feet.y) + CLIMB_STEP, target.y))
        if (await this._leg(run, isCurrent, goal, CLIMB_THINK_MS)) misses = 0
        else if (++misses >= MAX_MISSES) throw new Error('Stuck underground: could not find a way up.')
        continue
      }

      if (away > HOP_DISTANCE) {
        const step = HOP_DISTANCE / away
        const goal = new goals.GoalNearXZ(
          Math.floor(feet.x + (target.x - feet.x) * step),
          Math.floor(feet.z + (target.z - feet.z) * step),
          HOP_RANGE
        )
        if (await this._leg(run, isCurrent, goal, HOP_THINK_MS)) {
          misses = 0
        } else if (++misses >= MAX_MISSES) {
          throw new Error('Unable to reach target location.')
        } else if (underRock) {
          // Boxed in on the way: get up and over whatever's in the way.
          await this._leg(run, isCurrent, new GoalAbove(Math.floor(feet.y) + CLIMB_STEP), CLIMB_THINK_MS)
        }
        continue
      }

      for (const goal of arrivals) {
        if (await this._leg(run, isCurrent, goal, ARRIVE_THINK_MS)) return
      }
      if (++misses >= MAX_MISSES || !underRock || target.y < feet.y) {
        throw new Error('Unable to reach target location.')
      }
      await this._leg(run, isCurrent, new GoalAbove(Math.floor(feet.y) + CLIMB_STEP), CLIMB_THINK_MS)
    }
  }

  // One leg: true once at its goal, false if no way was found or the bot stalled. Throws only when the go-to
  // was replaced or cancelled.
  private async _leg(run: GoToRun, isCurrent: () => boolean, goal: Goal, thinkTimeout: number) {
    const bot = this.bot
    if (!bot?.pathfinder || !isCurrent()) throw new Error('Go-to cancelled.')
    if (goal.isEnd(bot.entity.position.floored())) return true
    run.goal = goal
    const pathfinder = bot.pathfinder
    pathfinder.setMovements(this.movements!)
    pathfinder.thinkTimeout = thinkTimeout
    pathfinder.tickTimeout = TRAVEL_TICK_TIMEOUT_MS
    let stopWatching = () => {}
    try {
      await Promise.race([
        pathfinder.goto(goal),
        new Promise<void>((_, reject) => {
          stopWatching = watchStall(bot, reject)
        }),
      ])
      return true
    } catch (error) {
      if (!isCurrent()) throw error
      // Clear the goal without pathfinder.stop(): its stop flag outlives the goal and kills the next leg.
      if (pathfinder.goal === goal) pathfinder.setGoal(null)
      return goal.isEnd(bot.entity.position.floored())
    } finally {
      stopWatching()
    }
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
