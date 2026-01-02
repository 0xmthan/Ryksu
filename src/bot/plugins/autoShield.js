class AutoShieldController {
  constructor() {
    this.bot = null
    this.desiredEnabled = false
    this.enabled = false
    this.hurtListener = null
    this.tickListener = null
    this.recentThreats = new Map()
    this.forceBlockUntil = 0
    this.threatLifetimeMs = 60_000
    this.maxThreatDistance = 8
    this.blockAfterAttackMs = 700
    this.desiredBlocking = false
    this.currentThreat = null
    this.lastLookTargetId = null
    this.nextAllowedLookTime = 0
  }

  attach(bot) {
    this.bot = bot
    if (this.desiredEnabled) {
      this._enable()
    }
  }

  detach() {
    this._disable()
    this.bot = null
  }

  setEnabled(enabled) {
    this.desiredEnabled = Boolean(enabled)
    if (!this.bot) {
      return
    }

    if (this.desiredEnabled) {
      this._enable()
    } else {
      this._disable()
    }
  }

  isEnabled() {
    return this.desiredEnabled
  }

  requestBlockAfterAttack(target) {
    if (!this.desiredEnabled) {
      return
    }

    if (target?.id) {
      this._recordThreat(target)
    }

    this.forceBlockUntil = Date.now() + this.blockAfterAttackMs
    this._evaluateThreats()
  }

  _enable() {
    if (!this.bot || this.enabled) {
      return
    }

    this.hurtListener = (entity, source) => {
      if (!this.bot?.entity || entity?.id !== this.bot.entity.id) {
        return
      }
      if (source) {
        this._recordThreat(source)
      }
    }
    this.tickListener = () => {
      this._evaluateThreats()
    }

    this.bot.on('entityHurt', this.hurtListener)
    this.bot.on('physicsTick', this.tickListener)
    this.enabled = true
  }

  _disable() {
    if (!this.bot || !this.enabled) {
      return
    }

    if (this.hurtListener) {
      this.bot.removeListener('entityHurt', this.hurtListener)
      this.hurtListener = null
    }

    if (this.tickListener) {
      this.bot.removeListener('physicsTick', this.tickListener)
      this.tickListener = null
    }

    this.recentThreats.clear()
    this.forceBlockUntil = 0
    this.desiredBlocking = false
    this.currentThreat = null
    this.lastLookTargetId = null
    this.nextAllowedLookTime = 0
    this._applyShieldState()
    this.enabled = false
  }

  _recordThreat(entity) {
    if (!entity?.id) {
      return
    }

    const type = (entity.type || '').toLowerCase()
    if (type !== 'player' && !this._looksHostile(entity)) {
      return
    }

    this.recentThreats.set(entity.id, Date.now())
    this._evaluateThreats()
  }

  _looksHostile(entity) {
    const identifiers = [entity.displayName, entity.name, entity.kind]
      .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
      .filter((value) => value.length > 0)

    return identifiers.some((id) =>
      [
        'zombie',
        'skeleton',
        'spider',
        'creeper',
        'enderman',
        'piglin',
        'pillager',
        'ravager',
        'guardian',
        'blaze',
        'witch',
        'wither',
      ].some((name) => id.includes(name))
    )
  }

  _evaluateThreats() {
    if (!this.desiredEnabled || !this.bot?.entity) {
      return
    }

    const now = Date.now()
    const expiration = now - this.threatLifetimeMs

    for (const [entityId, timestamp] of this.recentThreats.entries()) {
      if (timestamp < expiration) {
        this.recentThreats.delete(entityId)
      }
    }

    let closestThreat = null
    let closestDistance = Infinity

    for (const [entityId] of this.recentThreats.entries()) {
      const entity = this.bot.entities?.[entityId]
      if (!entity?.position) {
        continue
      }

      const distance = entity.position.distanceTo(this.bot.entity.position)
      if (!Number.isFinite(distance) || distance > this.maxThreatDistance) {
        continue
      }

      if (distance < closestDistance) {
        closestDistance = distance
        closestThreat = entity
      }
    }

    const hasForcedBlock = now < this.forceBlockUntil
    this.desiredBlocking = Boolean(closestThreat) || hasForcedBlock
    this.currentThreat = closestThreat
    this._applyShieldState()
  }

  async _ensureShieldEquipped() {
    if (!this.bot?.inventory) {
      return false
    }

    const offHandSlot = this.bot.getEquipmentDestSlot('off-hand')
    const current = this.bot.inventory.slots?.[offHandSlot]
    if (current?.name === 'shield') {
      return true
    }

    const candidate = this.bot.inventory.items().find((item) => item.name === 'shield')
    if (!candidate) {
      return false
    }

    try {
      await this.bot.equip(candidate, 'off-hand')
      return true
    } catch (error) {
      console.error('Failed to equip shield', error)
      return false
    }
  }

  _applyShieldState() {
    if (!this.bot) {
      return
    }

    if (!this.desiredBlocking) {
      if (this.bot.usingHeldItem) {
        this._lowerShield()
      }
      return
    }

    this._ensureShieldEquipped().then((equipped) => {
      if (!equipped || !this.desiredBlocking) {
        return
      }

      if (this.currentThreat?.position) {
        this._focusOnThreat(this.currentThreat)
      } else {
        this.lastLookTargetId = null
      }

      if (!this.bot.usingHeldItem) {
        try {
          this.bot.activateItem(true)
        } catch (error) {
          console.error('Failed to raise shield', error)
        }
      }
    })
  }

  _focusOnThreat(entity) {
    if (!entity?.position || !this.bot?.entity) {
      return
    }

    const now = Date.now()
    const needsLook = this.lastLookTargetId !== entity.id || now >= this.nextAllowedLookTime
    if (!needsLook) {
      return
    }

    const aim = entity.position.clone()
    aim.y += typeof entity.height === 'number' ? entity.height * 0.6 : 0.6

    const origin = this.bot.entity.position
    if (!origin) {
      return
    }

    const dx = aim.x - origin.x
    const dy = aim.y - origin.y
    const dz = aim.z - origin.z
    const distanceSq = dx * dx + dy * dy + dz * dz
    if (!Number.isFinite(distanceSq) || distanceSq < 0.04) {
      return
    }

    this.bot
      .lookAt(aim, true)
      .catch(() => {
        /* ignore look failures */
      })
    this.lastLookTargetId = entity.id
    this.nextAllowedLookTime = now + 250
  }

  _lowerShield() {
    if (!this.bot || !this.bot.usingHeldItem) {
      return
    }

    try {
      this.bot.deactivateItem()
    } catch (error) {
      console.error('Failed to lower shield', error)
    }
  }
}

module.exports = { AutoShieldController }
