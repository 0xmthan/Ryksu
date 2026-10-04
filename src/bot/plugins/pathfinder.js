const { pathfinder: pathfinderPlugin, Movements, goals } = require('./core/pathfinder')
const { Vec3 } = require('vec3')
const { applyBlockEditing } = require('./blockEditing')

// mineflayer-pathfinder treats open doors as solid obstacles because prismarine-block
// assigns them boundingBox: 'block'. This patch marks open doors and open fence gates as safe and non-physical
// so the pathfinder can walk right through them instead of seeing an impassable obstacle or trying to break them.
const isOpenDoorway = (b) => {
  if (
    !b ||
    !(b.name?.endsWith('_door') || b.name === 'door' || b.name === 'wooden_door' || b.name?.includes('gate')) ||
    b.name?.endsWith('trapdoor')
  ) {
    return false
  }
  const props = typeof b.getProperties === 'function' ? b.getProperties() : b._properties || {}
  return props.open === true || props.open === 'true'
}

if (!Movements.prototype._openDoorPatched) {
  Movements.prototype._openDoorPatched = true
  const originalGetBlock = Movements.prototype.getBlock
  Movements.prototype.getBlock = function (pos, dx, dy, dz) {
    const b = originalGetBlock.call(this, pos, dx, dy, dz)
    if (isOpenDoorway(b)) {
      b.safe = true
      b.physical = false
      b.height = (pos ? pos.y : 0) + dy
      b.openDoorway = true
    }
    return b
  }

  // An open door still has its panel along one edge of the block, so only straight moves fit through.
  // Diagonals that start, end or cut a corner in a doorway clip the panel and leave the bot stuck on it.
  const originalGetMoveDiagonal = Movements.prototype.getMoveDiagonal
  Movements.prototype.getMoveDiagonal = function (node, dir, neighbors) {
    for (const [dx, dz] of [
      [0, 0],
      [dir.x, dir.z],
      [dir.x, 0],
      [0, dir.z],
    ]) {
      for (const dy of [0, 1]) {
        if (this.getBlock(node, dx, dy, dz).openDoorway) return
      }
    }
    return originalGetMoveDiagonal.call(this, node, dir, neighbors)
  }
}

// The pathfinder picks walk / sprint / sprint-jump each tick by simulating ahead. Coming into a doorway
// slightly off-center, the walk simulation clips the door panel and it falls back to jumping, which a
// two-high door never needs. Runs right after the pathfinder sets its controls and calls the jump off
// (and the sprint, which overshoots the turn into the door) while an open doorway is right there, unless
// a real step up is directly ahead.
const DOORWAY_REACH = 1.6

const nearOpenDoorway = (bot) => {
  const feet = bot.entity.position.floored()
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const block = bot.blockAt(feet.offset(dx, 0, dz))
      if (!isOpenDoorway(block)) continue
      const center = block.position.offset(0.5, 0, 0.5)
      if (Math.hypot(center.x - bot.entity.position.x, center.z - bot.entity.position.z) <= DOORWAY_REACH) return true
    }
  }
  return false
}

const stepAhead = (bot) => {
  const yaw = bot.entity.yaw
  const ahead = bot.entity.position.offset(-Math.sin(yaw) * 0.8, 0, -Math.cos(yaw) * 0.8).floored()
  const block = bot.blockAt(ahead)
  return Boolean(block && block.boundingBox === 'block' && !isOpenDoorway(block))
}

const smoothDoorways = (bot) => () => {
  if (!bot.entity || !bot.pathfinder?.isMoving?.() || bot.entity.isInWater) return
  if (!bot.getControlState('jump') && !bot.getControlState('sprint')) return
  if (!nearOpenDoorway(bot) || stepAhead(bot)) return
  bot.setControlState('jump', false)
  bot.setControlState('sprint', false)
}

class PathfinderController {
  constructor() {
    this.bot = null
    this.options = { followEnabled: false, followTarget: '' }
    this.movements = null
    this.spawnListener = null
    this.followInterval = null
    this.activeGoTo = null
    this.goalReachedListener = null
    this.pathResetListener = null
    this._handleGoalReached = this._handleGoalReached.bind(this)
    this._handlePathReset = this._handlePathReset.bind(this)
    this.allowBlockBreak = true
    this.followPausedUntil = 0
    this.followedEntity = null
  }

  attach(bot) {
    this.bot = bot
    this._ensurePlugin()
    this._bindPathfinderEvents()
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
    this._unbindPathfinderEvents()
    this.movements = null
    this.bot = null
  }

  setBlockBreakingAllowed(allowed) {
    this.allowBlockBreak = Boolean(allowed)
    if (this.movements) {
      applyBlockEditing(this.movements, this.allowBlockBreak)
    }
    return this.allowBlockBreak
  }

  getOptions() {
    return { ...this.options }
  }

  setOptions(options = {}) {
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
      this._activateGoTo(options.goToLocation)
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
  pauseFollow(ms) {
    this.followPausedUntil = Date.now() + ms
  }

  resumeFollow() {
    this.followPausedUntil = 0
    this._applyFollowGoal()
  }

  setTemporaryGoal(goal) {
    if (!this.bot || !this._ensurePlugin()) {
      return false
    }
    this._cancelGoTo('replace-goal')
    this.bot.pathfinder.setMovements(this.movements)
    this.bot.pathfinder.setGoal(goal, true)
    return true
  }

  clearTemporaryGoal() {
    this.bot?.pathfinder?.setGoal(null)
  }

  goNear(position, range) {
    return this.goto(new goals.GoalNear(position.x, position.y, position.z, range))
  }

  goto(goal) {
    if (!this.bot || !this._ensurePlugin()) {
      return Promise.reject(new Error('Pathfinder is not available.'))
    }

    this._cancelGoTo('replace-goal')
    this.bot.pathfinder.setMovements(this.movements)
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

  _startFollowing() {
    if (!this._ensurePlugin()) {
      return
    }

    if (!this.spawnListener) {
      this.spawnListener = () => {
        this._applyFollowGoal()
      }
      this.bot.on('spawn', this.spawnListener)
    }

    if (!this.followInterval) {
      this.followInterval = setInterval(() => {
        this._applyFollowGoal()
      }, 2000)
    }

    this._applyFollowGoal()
  }

  _stopFollowing({ preserveGoTo = false } = {}) {
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

    const currentGoal = this.bot.pathfinder.goal
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

  followEntity(entity) {
    this.followedEntity = entity
    this._applyFollowGoal()
  }

  _isRecoverablePathError(error) {
    if (!error) {
      return false
    }

    const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
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

  _activateGoTo(location) {
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

    this._cancelGoTo('replace-goal')

    const isDoor = location.door && typeof location.door === 'object'
    const doorPos = isDoor
      ? {
          x: Math.floor(location.door.x),
          y: Math.floor(location.door.y),
          z: Math.floor(location.door.z),
        }
      : null

    const goalsToTry = doorPos
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

    try {
      this.bot.pathfinder.setMovements(this.movements)
    } catch (error) {
      console.error('[Pathfinder] Failed to set movements before go-to', error)
      return
    }

    const botPosition = this.bot?.entity?.position
    if (botPosition) {
      const targetVec = new Vec3(target.x + 0.5, target.y, target.z + 0.5)
      const distance = botPosition.distanceTo(targetVec)
      if (Number.isFinite(distance)) {
      }
    }

    // This go-to's own record; a newer go-to replaces it, and then this one must leave everything alone
    // (its promise fails with GoalChanged as the new goal takes over).
    const run = { target, goal: null, promise: null }
    const isCurrent = () => this.activeGoTo === run

    const attemptGoal = (index) => {
      if (!isCurrent()) {
        return Promise.resolve()
      }

      if (index >= goalsToTry.length) {
        this.activeGoTo = null
        return Promise.reject(new Error('Unable to reach target location.'))
      }

      const { label, goal } = goalsToTry[index]
      run.goal = goal

      return this.bot.pathfinder.goto(goal).catch((error) => {
        if (!isCurrent() || run.goal !== goal) {
          return Promise.reject(error)
        }

        if (error?.name === 'GoalChanged' || error?.code === 'GoalChanged') {
          this.activeGoTo = null
          return Promise.reject(error)
        }

        if (this._isRecoverablePathError(error)) {
          try {
            this.bot.pathfinder.stop()
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

  _cancelGoTo(reason = 'cancel') {
    if (!this.activeGoTo) {
      if (reason !== 'replace-goal') {
      }
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

  _handleGoalReached() {
    this._clearGoal()
  }

  // The pathfinder re-plans on its own (new goal, blocks changing, getting stuck), so a go-to carries on
  // through a reset.
  _handlePathReset() {}

  _bindPathfinderEvents() {
    if (!this.bot?.pathfinder) {
      return
    }

    if (!this.goalReachedListener) {
      this.goalReachedListener = this._handleGoalReached
      this.bot.pathfinder.on('goal_reached', this.goalReachedListener)
    }

    if (!this.pathResetListener) {
      this.pathResetListener = this._handlePathReset
      this.bot.pathfinder.on('path_reset', this.pathResetListener)
    }
  }

  _unbindPathfinderEvents() {
    if (!this.bot?.pathfinder) {
      this.goalReachedListener = null
      this.pathResetListener = null
      return
    }

    if (this.goalReachedListener) {
      this.bot.pathfinder.removeListener('goal_reached', this.goalReachedListener)
      this.goalReachedListener = null
    }

    if (this.pathResetListener) {
      this.bot.pathfinder.removeListener('path_reset', this.pathResetListener)
      this.pathResetListener = null
    }
  }

  _clearGoal() {
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

module.exports = { PathfinderController }
