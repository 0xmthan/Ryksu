const { goals } = require('mineflayer-pathfinder')

// Backs the bot away from creepers instead of fighting them.
const FLEE_TRIGGER_DISTANCE = 5
// Creepers cancel their fuse beyond 7 blocks; stop running a little past that.
const SAFE_DISTANCE = 10
const RUN_DISTANCE = 10
const CHECK_EVERY_TICKS = 4
const REPATH_EVERY_CHECKS = 3
const FOLLOW_PAUSE_MS = 1500

class CreeperWatch {
  constructor({ pathfinder, onAlert, isManuallyControlled = () => false }) {
    this.pathfinder = pathfinder
    this.onAlert = onAlert
    this.isManuallyControlled = isManuallyControlled
    this.bot = null
    this.fleeingFrom = null
    this.ticks = 0
    this.checksSinceRepath = 0
    this._handleTick = this._handleTick.bind(this)
  }

  attach(bot) {
    this.bot = bot
    this.fleeingFrom = null
    bot.on('physicsTick', this._handleTick)
  }

  detach() {
    this.bot?.removeListener('physicsTick', this._handleTick)
    this.bot = null
    this.fleeingFrom = null
  }

  isFleeing() {
    return this.fleeingFrom !== null
  }

  _handleTick() {
    if (this.isManuallyControlled()) {
      this.fleeingFrom = null
      return
    }
    this.ticks = (this.ticks + 1) % CHECK_EVERY_TICKS
    if (this.ticks !== 0 || !this.bot?.entity || this.bot.isSleeping) {
      return
    }

    const creeper = this._nearestCreeper()
    const distance = creeper ? creeper.position.distanceTo(this.bot.entity.position) : Infinity

    if (this.fleeingFrom) {
      if (distance >= SAFE_DISTANCE || !creeper) {
        this._stopFleeing()
        return
      }
      this.pathfinder.pauseFollow(FOLLOW_PAUSE_MS)
      this.checksSinceRepath++
      if (creeper !== this.fleeingFrom || this.checksSinceRepath >= REPATH_EVERY_CHECKS) {
        this._fleeFrom(creeper)
      }
      return
    }

    if (distance <= FLEE_TRIGGER_DISTANCE) {
      this.onAlert?.('Creeper nearby, backing off.')
      this._fleeFrom(creeper)
    }
  }

  // Run to a point straight away from the creeper; re-aimed every few checks as it moves.
  _fleeFrom(creeper) {
    this.fleeingFrom = creeper
    this.checksSinceRepath = 0
    this.pathfinder.pauseFollow(FOLLOW_PAUSE_MS)

    const position = this.bot.entity.position
    let away = position.minus(creeper.position)
    away.y = 0
    if (away.norm() < 0.01) {
      away = away.offset(1, 0, 0)
    }
    const target = position.plus(away.normalize().scaled(RUN_DISTANCE))
    this.pathfinder.setTemporaryGoal(new goals.GoalXZ(Math.floor(target.x), Math.floor(target.z)))
  }

  _stopFleeing() {
    this.fleeingFrom = null
    this.pathfinder.clearTemporaryGoal()
    this.pathfinder.resumeFollow()
  }

  _nearestCreeper() {
    const position = this.bot.entity.position
    let nearest = null
    let nearestDistance = Infinity
    for (const entity of Object.values(this.bot.entities)) {
      if (entity?.name !== 'creeper' || !entity.isValid) {
        continue
      }
      const distance = entity.position.distanceTo(position)
      if (distance < nearestDistance) {
        nearest = entity
        nearestDistance = distance
      }
    }
    return nearest
  }
}

module.exports = { CreeperWatch }
