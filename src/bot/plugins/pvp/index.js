const { pathfinder: pathfinderPlugin, Movements, goals } = require('mineflayer-pathfinder')
const attackSpeeds = require('./attackSpeeds.json')

const DEFAULT_CONFIG = {
  viewDistance: 32,
  attackRange: 3.2,
  followRange: 1.75,
  cooldownPadding: 2,
  allowBlockBreak: true,
}

class PvpController {
  constructor() {
    this.bot = null
    this.enabled = false
    this.movements = null
    this.tickListener = null
    this.target = null
    this.cooldownTicks = 0
    this.config = { ...DEFAULT_CONFIG }
    this.movementAllowed = true
    this.mobsEnabled = false
    this.playerEnabled = false
    this.playerTarget = ''
    this.isControllingPathfinder = false
  }

  attach(bot) {
    this.bot = bot
    this._ensurePathfinder()

    if (!this.tickListener) {
      this.tickListener = () => this._handleTick()
      this.bot.on('physicsTick', this.tickListener)
    }
  }

  detach() {
    if (this.bot && this.tickListener) {
      this.bot.removeListener('physicsTick', this.tickListener)
    }
    this.tickListener = null
    this._clearTarget()
    this.movements = null
    this.bot = null
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled)
    if (!this.enabled) {
      this._clearTarget()
    }
    return this.enabled
  }

  isEnabled() {
    return this.enabled
  }

  setOptions(options) {
    if (typeof options !== 'object' || options === null) {
      return
    }

    // Update config if any valid config options are provided
    const nextConfig = { ...this.config }
    let configChanged = false

    if (typeof options.viewDistance === 'number') {
      nextConfig.viewDistance = options.viewDistance
      configChanged = true
    }
    if (typeof options.attackRange === 'number') {
      nextConfig.attackRange = options.attackRange
      configChanged = true
    }
    if (typeof options.followRange === 'number') {
      nextConfig.followRange = options.followRange
      configChanged = true
    }
    if (typeof options.cooldownPadding === 'number') {
      nextConfig.cooldownPadding = options.cooldownPadding
      configChanged = true
    }
    if (typeof options.allowBlockBreak === 'boolean') {
      nextConfig.allowBlockBreak = options.allowBlockBreak
      configChanged = true
      if (this.movements) {
        this.movements.canDig = options.allowBlockBreak
      }
    }

    if (configChanged) {
      this.config = nextConfig
    }

    // Handle mob and player targeting options
    if (typeof options.mobEnabled === 'boolean') {
      this.mobsEnabled = options.mobEnabled
      this.setEnabled(this.mobsEnabled || this.playerEnabled)
    }

    if (typeof options.playerEnabled === 'boolean') {
      this.playerEnabled = options.playerEnabled
      this.setEnabled(this.mobsEnabled || this.playerEnabled)
    }

    if (typeof options.playerTarget === 'string') {
      this.playerTarget = options.playerTarget
    }

    if (typeof options.movementAllowed === 'boolean') {
      this.setMovementAllowed(options.movementAllowed)
    }
  }

  setMovementAllowed(allowed) {
    this.movementAllowed = Boolean(allowed)
    if (!this.movementAllowed && this.bot?.pathfinder && this.isControllingPathfinder) {
      try {
        this.bot.pathfinder.setGoal(null)
      } catch (error) {
        console.error('Failed to clear goal when disabling pvp movement', error)
      } finally {
        this.isControllingPathfinder = false
      }
    }
  }

  _ensurePathfinder() {
    if (!this.bot) {
      return false
    }

    if (!this.bot.pathfinder) {
      try {
        this.bot.loadPlugin(pathfinderPlugin)
      } catch (error) {
        console.error('Failed to load pathfinder plugin for PvP', error)
        return false
      }
    }

    if (!this.movements && this.bot.pathfinder) {
      this.movements = new Movements(this.bot)
      this.movements.canDig = this.config.allowBlockBreak
    } else if (this.movements) {
      this.movements.canDig = this.config.allowBlockBreak
    }

    return Boolean(this.bot.pathfinder)
  }

  _handleTick() {
    if (!this.enabled || !this.bot?.entity) {
      return
    }

    if (this.cooldownTicks > 0) {
      this.cooldownTicks -= 1
    }

    if (!this.target || !this._isValidTarget(this.target)) {
      this.target = this._findTarget()
      if (!this.target) {
        this._clearTarget()
        return
      }
    }

    let distance = this.bot.entity.position.distanceTo(this.target.position)

    if (distance > this.config.viewDistance) {
      this._clearTarget()
      return
    }

    if (!this.movementAllowed) {
      const withinAttackRange =
        Number.isFinite(distance) && distance <= this.config.attackRange + 0.5

      if (!withinAttackRange) {
        const closerTarget = this._findTarget(this.config.attackRange + 0.5)
        if (closerTarget) {
          this.target = closerTarget
          distance = this.bot.entity.position.distanceTo(closerTarget.position)
        } else {
          this._clearTarget()
          return
        }
      }
    }

    if (this.movementAllowed && distance > this.config.attackRange) {
      this._followTarget(this.target)
      return
    }

    this._stopFollowing()
    this._attemptAttack(this.target)
  }

  _findTarget(maxDistance = this.config.viewDistance) {
    if (!this.bot?.entity?.position) {
      return null
    }

    const candidates = Object.values(this.bot.entities)
      .filter((entity) => this._isValidTarget(entity))
      .map((entity) => ({ entity, distance: entity.position.distanceTo(this.bot.entity.position) }))
      .filter((item) => Number.isFinite(item.distance) && item.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)

    return candidates[0]?.entity ?? null
  }

  _isValidTarget(entity) {
    if (!entity || !entity.isValid || !entity.position) {
      return false
    }

    if (entity.type && entity.type.toLowerCase() === 'object') {
      return false
    }

    // Check for player target
    if (
      this.playerEnabled &&
      this.playerTarget &&
      entity.type === 'player' &&
      entity.username === this.playerTarget
    ) {
      return true
    }

    if (this.mobsEnabled) {
      const entityType = (entity.type || '').toLowerCase()
      const identifiers = [entityType, entity.kind, entity.name, entity.displayName, entity.username].map(
        (id) => (id || '').toLowerCase()
      )

      const isTargetMob = identifiers.some((id) => {
        return [
          'zombie',
          'skeleton',
          'spider',
          'creeper',
          'enderman',
          'witch',
          'blaze',
          'ghast',
          'magma_cube',
          'slime',
          'phantom',
          'drowned',
          'husk',
          'wither_skeleton',
        ].some((name) => id.includes(name))
      })

      if (isTargetMob) {
        return true
      }
    }

    return false
  }

  _followTarget(target) {
    if (!this.movementAllowed || !this._ensurePathfinder()) {
      return
    }

    if (!this.movements) {
      this.movements = new Movements(this.bot)
    }

    try {
      this.bot.pathfinder.setMovements(this.movements)
      this.bot.pathfinder.setGoal(new goals.GoalFollow(target, this.config.followRange), true)
      this.isControllingPathfinder = true
    } catch (error) {
      console.error('Failed to set PvP follow goal', error)
    }
  }

  _stopFollowing() {
    if (!this.bot?.pathfinder) {
      return
    }

    try {
      if (this.isControllingPathfinder) {
        this.bot.pathfinder.setGoal(null)
      }
    } catch (error) {
      console.error('Failed to clear PvP follow goal', error)
    } finally {
      this.isControllingPathfinder = false
    }
  }

  _attemptAttack(target) {
    if (!target?.isValid || !this.bot?.entity?.position) {
      return
    }

    const distance = this.bot.entity.position.distanceTo(target.position)
    if (!Number.isFinite(distance) || distance > this.config.attackRange + 0.5) {
      return
    }

    if (this.cooldownTicks > 0) {
      return
    }

    const aimPosition = target.position.offset(0, target.height ? target.height * 0.6 : 1, 0)

    this.bot
      .lookAt(aimPosition, true)
      .then(() => {
        if (!target.isValid) {
          return
        }
        this.bot.attack(target)
        const heldName = this.bot.heldItem?.name ?? 'other'
        this.cooldownTicks = this._getCooldownTicks(heldName) + this.config.cooldownPadding
      })
      .catch(() => {
        this.cooldownTicks = 5
      })
  }

  _getCooldownTicks(weaponName) {
    const speed = attackSpeeds[weaponName] ?? attackSpeeds.other ?? 4
    if (!speed || speed <= 0) {
      return 20
    }
    return Math.max(8, Math.floor((1 / speed) * 20))
  }

  _clearTarget() {
    if (this.bot?.pathfinder && this.movementAllowed && this.isControllingPathfinder) {
      try {
        this.bot.pathfinder.setGoal(null)
      } catch (error) {
        console.error('Failed to clear PvP goal', error)
      }
    }
    this.isControllingPathfinder = false
    this.target = null
  }
}

module.exports = { PvpController }
