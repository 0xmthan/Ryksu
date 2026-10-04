const { pathfinder: pathfinderPlugin, Movements, goals } = require('mineflayer-pathfinder')
const attackSpeeds = require('./attackSpeeds.json')
const { applyBlockEditing } = require('../blockEditing')

// How long the bot keeps fighting back after a mob last hurt it.
const DEFEND_DURATION_MS = 30000

const DEFAULT_CONFIG = {
  viewDistance: 32,
  attackRange: 3.2,
  followRange: 1.75,
  cooldownPadding: 2,
  allowBlockBreak: true,
}

class PvpController {
  constructor({ autoTool, autoShield, isFleeing, onDefend } = {}) {
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
    this.autoTool = autoTool ?? null
    this.autoShield = autoShield ?? null
    this.jumpAttackEnabled = true
    this.jumpReleaseTimer = null
    this.pendingAttack = null
    this.isFleeing = isFleeing ?? (() => false)
    this.onDefend = onDefend ?? null
    this.defendTarget = null
    this.defendUntil = 0
    this.hurtListener = null
  }

  attach(bot) {
    this.bot = bot
    this._ensurePathfinder()

    if (!this.tickListener) {
      this.tickListener = () => this._handleTick()
      this.bot.on('physicsTick', this.tickListener)
    }

    if (!this.hurtListener) {
      this.hurtListener = (entity, source) => this._handleHurt(entity, source)
      this.bot.on('entityHurt', this.hurtListener)
    }
  }

  detach() {
    if (this.bot && this.tickListener) {
      this.bot.removeListener('physicsTick', this.tickListener)
    }
    if (this.bot && this.hurtListener) {
      this.bot.removeListener('entityHurt', this.hurtListener)
    }
    this.tickListener = null
    this.hurtListener = null
    this.defendTarget = null
    this._clearTarget()
    this.movements = null
    if (this.jumpReleaseTimer) {
      clearTimeout(this.jumpReleaseTimer)
      this.jumpReleaseTimer = null
    }
    if (this.bot) {
      try {
        this.bot.setControlState('jump', false)
      } catch {
        // ignore
      }
    }
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
        applyBlockEditing(this.movements, options.allowBlockBreak)
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

    if (typeof options.jumpAttackEnabled === 'boolean') {
      if (!options.jumpAttackEnabled) this._cancelPendingAttack()
      this.jumpAttackEnabled = options.jumpAttackEnabled
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
      applyBlockEditing(this.movements, this.config.allowBlockBreak)
    } else if (this.movements) {
      applyBlockEditing(this.movements, this.config.allowBlockBreak)
    }

    return Boolean(this.bot.pathfinder)
  }

  // Attacks one entity on request (chasing it until it dies or gets out of view), whatever the PvP
  // settings say; it rides on the same target slot as fighting back.
  attackEntity(entity) {
    this._cancelPendingAttack()
    this.defendTarget = entity
    this.defendUntil = Infinity
    this.target = entity
  }

  // Drops a requested attack (or fight-back) target.
  stopAttacking() {
    if (!this.defendTarget) return
    this.defendTarget = null
    this.defendUntil = 0
    this._clearTarget()
  }

  // Fight back against any mob that hurts the bot, even when mob attacking is turned off.
  _handleHurt(entity, source) {
    if (!this.bot?.entity || entity !== this.bot.entity || !source || source === this.bot.entity) {
      return
    }
    if (source.type === 'player' || source.name === 'creeper') {
      return
    }
    if (this.defendTarget !== source) {
      this.onDefend?.(source)
    }
    this.defendTarget = source
    this.defendUntil = Date.now() + DEFEND_DURATION_MS
  }

  _isDefending() {
    const target = this.defendTarget
    if (!target) {
      return false
    }
    const distance = this.bot?.entity?.position?.distanceTo(target.position) ?? Infinity
    if (!target.isValid || Date.now() > this.defendUntil || distance > this.config.viewDistance) {
      this.defendTarget = null
      return false
    }
    return true
  }

  _handleTick() {
    if (!this.bot?.entity) {
      return
    }

    // Running from a creeper owns the pathfinder; don't chase or clear its goal.
    if (this.isFleeing()) {
      this._cancelPendingAttack()
      this.isControllingPathfinder = false
      return
    }

    const defending = this._isDefending()
    if (!this.enabled && !defending) {
      if (this.target) {
        this._clearTarget()
      }
      return
    }

    if (defending && this.target !== this.defendTarget) {
      this.target = this.defendTarget
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
      const withinAttackRange = Number.isFinite(distance) && distance <= this.config.attackRange + 0.5

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

    if (entity === this.defendTarget) {
      return true
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
      applyBlockEditing(this.movements, this.config.allowBlockBreak)
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

  async _attemptAttack(target) {
    const bot = this.bot
    if (this.pendingAttack || !target?.isValid || !bot?.entity?.position || this.cooldownTicks > 0) return

    const inRange = () => {
      const distance = bot.entity?.position?.distanceTo(target.position)
      return Number.isFinite(distance) && distance <= this.config.attackRange + 0.5
    }
    if (!inRange()) return

    const run = { cancelJump: null }
    this.pendingAttack = run
    const isCurrent = () =>
      this.pendingAttack === run &&
      this.bot === bot &&
      this.target === target &&
      target.isValid &&
      !this.isFleeing()

    try {
      if (this.autoTool?.isEnabled?.() && typeof this.autoTool.equipBestWeapon === 'function') {
        await this.autoTool.equipBestWeapon().catch(() => {})
      }
      if (!isCurrent() || !inRange()) return

      await this._triggerJumpAttack(bot, run)
      if (!isCurrent() || !inRange()) return

      const aimPosition = target.position.offset(0, target.height ? target.height * 0.6 : 1, 0)
      await bot.lookAt(aimPosition, true)
      if (!isCurrent() || !inRange()) return

      bot.attack(target)
      const heldName = bot.heldItem?.name ?? 'other'
      this.cooldownTicks = this._getCooldownTicks(heldName) + this.config.cooldownPadding
      if (this.autoShield?.isEnabled?.()) {
        this.autoShield.requestBlockAfterAttack(target)
      }
    } catch {
      if (isCurrent()) this.cooldownTicks = 5
    } finally {
      if (this.pendingAttack === run) this.pendingAttack = null
    }
  }

  _getCooldownTicks(weaponName) {
    const speed = attackSpeeds[weaponName] ?? attackSpeeds.other ?? 4
    if (!speed || speed <= 0) {
      return 20
    }
    return Math.max(8, Math.floor((1 / speed) * 20))
  }

  _clearTarget() {
    this._cancelPendingAttack()
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

  _cancelPendingAttack() {
    const run = this.pendingAttack
    this.pendingAttack = null
    run?.cancelJump?.()
    if (this.jumpReleaseTimer) {
      clearTimeout(this.jumpReleaseTimer)
      this.jumpReleaseTimer = null
      try {
        this.bot?.setControlState('jump', false)
      } catch {}
    }
  }

  _triggerJumpAttack(bot, run) {
    if (!this.jumpAttackEnabled || !bot.entity?.onGround) return Promise.resolve()

    return new Promise((resolve) => {
      let timeout
      const finish = () => {
        clearTimeout(timeout)
        bot.removeListener('physicsTick', onTick)
        run.cancelJump = null
        resolve()
      }
      const onTick = () => {
        if (bot.entity && !bot.entity.onGround) finish()
      }
      run.cancelJump = finish
      bot.on('physicsTick', onTick)
      // A low ceiling can prevent takeoff; keep fighting rather than waiting indefinitely.
      timeout = setTimeout(finish, 500)
      try {
        bot.setControlState('jump', true)
        if (this.jumpReleaseTimer) clearTimeout(this.jumpReleaseTimer)
        this.jumpReleaseTimer = setTimeout(() => {
          this.jumpReleaseTimer = null
          try {
            bot.setControlState('jump', false)
          } catch {}
        }, 250)
      } catch {
        finish()
      }
    })
  }
}

module.exports = { PvpController }
