const { pathfinder: pathfinderPlugin, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

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
  }

  attach(bot) {
    this.bot = bot
    this._ensurePlugin()
    this._bindPathfinderEvents()

    if (this.options.followEnabled) {
      this._startFollowing()
    }
  }

  detach() {
    this._stopFollowing()
    this._unbindPathfinderEvents()
    this.movements = null
    this.bot = null
  }

  setBlockBreakingAllowed(allowed) {
    this.allowBlockBreak = Boolean(allowed)
    if (this.movements) {
      this.movements.canDig = this.allowBlockBreak
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
      this.movements.canDig = this.allowBlockBreak
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
    if (!this.bot?.pathfinder || !this.options.followEnabled) {
      return
    }

    const targetName = this.options.followTarget.trim()
    if (!targetName) {
      this.bot.pathfinder.setGoal(null)
      return
    }

    const playerData = this.bot.players?.[targetName]
    const entity = playerData?.entity
    if (!entity) {
      return
    }

    if (!this.movements) {
      this.movements = new Movements(this.bot)
    }
    if (this.movements) {
      this.movements.canDig = this.allowBlockBreak
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
      message.includes('path could not be found')
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
      this.movements.canDig = this.allowBlockBreak
    }

    this._cancelGoTo('replace-goal')

    const goalsToTry = [
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

    const attemptGoal = (index) => {
      if (!this.activeGoTo) {
        return Promise.resolve()
      }

      if (index >= goalsToTry.length) {
        this.activeGoTo = null
        return Promise.reject(new Error('Unable to reach target location.'))
      }

      const { label, goal } = goalsToTry[index]
      this.activeGoTo.goal = goal

      return this.bot.pathfinder.goto(goal).catch((error) => {
        if (!this.activeGoTo || this.activeGoTo.goal !== goal) {
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

    this.activeGoTo = { target, goal: null, promise: null }

    const gotoPromise = new Promise((resolve, reject) => {
      attemptGoal(0)
        .then((result) => {
          if (this.activeGoTo) {
            this.activeGoTo = null
          }
          resolve(result)
        })
        .catch((error) => {
          if (this.activeGoTo) {
            this.activeGoTo = null
          }
          reject(error)
        })
        .finally(() => {
          if (!this.activeGoTo && this.bot?.pathfinder) {
            this.bot.pathfinder.setGoal(null)
          }
        })
    })

    if (this.activeGoTo) {
      this.activeGoTo.promise = gotoPromise
    }
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

  _handlePathReset() {
    this.activeGoTo = null
  }

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
