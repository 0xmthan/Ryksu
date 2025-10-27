const { pathfinder: pathfinderPlugin, Movements, goals } = require('mineflayer-pathfinder')

class PathfinderController {
  constructor() {
    this.bot = null
    this.options = { followEnabled: false, followTarget: '' }
    this.movements = null
    this.spawnListener = null
    this.followInterval = null
  }

  attach(bot) {
    this.bot = bot
    this._ensurePlugin()

    if (this.options.followEnabled) {
      this._startFollowing()
    }
  }

  detach() {
    this._stopFollowing()
    this.movements = null
    this.bot = null
  }

  getOptions() {
    return { ...this.options }
  }

  setOptions(options = {}) {
    const followEnabled =
      typeof options.followEnabled === 'boolean' ? options.followEnabled : this.options.followEnabled

    const followTarget =
      typeof options.followTarget === 'string'
        ? options.followTarget.trim()
        : this.options.followTarget

    this.options = {
      ...this.options,
      followEnabled,
      followTarget,
    }

    if (!this.bot) {
      return this.getOptions()
    }

    if (this.options.followEnabled) {
      this._startFollowing()
    } else {
      this._stopFollowing()
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
        console.error('Failed to load pathfinder plugin', error)
        return false
      }
    }

    if (!this.movements && this.bot.pathfinder) {
      this.movements = new Movements(this.bot)
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

  _stopFollowing() {
    if (this.followInterval) {
      clearInterval(this.followInterval)
      this.followInterval = null
    }

    if (this.spawnListener && this.bot) {
      this.bot.removeListener('spawn', this.spawnListener)
      this.spawnListener = null
    }

    if (this.bot?.pathfinder) {
      try {
        this.bot.pathfinder.setGoal(null)
      } catch (error) {
        console.error('Failed to clear pathfinder goal', error)
      }
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

    try {
      this.bot.pathfinder.setMovements(this.movements)
    } catch (error) {
      console.error('Failed to set pathfinder movements', error)
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
      console.error('Failed to set follow goal', error)
    }
  }
}

module.exports = { PathfinderController }
