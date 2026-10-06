import type { Bot } from 'mineflayer'
import type { Entity } from 'prismarine-entity'

export class AutoShieldController {
  private isManuallyControlled: () => boolean
  private isOverridden: () => boolean
  private bot: Bot | null
  private desiredEnabled: boolean
  private enabled: boolean
  private hurtListener: ((entity: Entity, source?: Entity) => void) | null
  private tickListener: (() => void) | null
  private recentThreats: Map<number, number>
  private forceBlockUntil: number
  private threatLifetimeMs: number
  private maxThreatDistance: number
  private blockAfterAttackMs: number
  private desiredBlocking: boolean
  private currentThreat: Entity | null
  private lastLookTargetId: number | null
  private nextAllowedLookTime: number

  // `isOverridden`: something else (the creeper fight) is handling the shield right now.
  constructor({
    isManuallyControlled = () => false,
    isOverridden = () => false,
  }: { isManuallyControlled?: () => boolean; isOverridden?: () => boolean } = {}) {
    this.isManuallyControlled = isManuallyControlled
    this.isOverridden = isOverridden
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

  attach(bot: Bot) {
    this.bot = bot
    if (this.desiredEnabled) {
      this._enable()
    }
  }

  detach() {
    this._disable()
    this.bot = null
  }

  setEnabled(enabled: boolean) {
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

  requestBlockAfterAttack(target: Entity | null | undefined) {
    if (!this.desiredEnabled) {
      return
    }

    if (target?.id) {
      this._recordThreat(target)
    }

    this.forceBlockUntil = Date.now() + this.blockAfterAttackMs
    this._evaluateThreats()
  }

  private _enable() {
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

    this.bot.on('entityHurt', this.hurtListener as never)
    this.bot.on('physicsTick', this.tickListener)
    this.enabled = true
  }

  private _disable() {
    if (!this.bot || !this.enabled) {
      return
    }

    if (this.hurtListener) {
      this.bot.removeListener('entityHurt', this.hurtListener as never)
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

  private _recordThreat(entity: Entity) {
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

  private _looksHostile(entity: Entity) {
    const identifiers = [entity.displayName, entity.name, entity.kind as unknown]
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

  private _evaluateThreats() {
    if (!this.desiredEnabled || !this.bot?.entity || this.isOverridden()) {
      return
    }

    const now = Date.now()
    const expiration = now - this.threatLifetimeMs

    for (const [entityId, timestamp] of this.recentThreats.entries()) {
      if (timestamp < expiration) {
        this.recentThreats.delete(entityId)
      }
    }

    let closestThreat: Entity | null = null
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

  private async _ensureShieldEquipped() {
    if (!this.bot?.inventory) {
      return false
    }

    const offHandSlot = this.bot.getEquipmentDestSlot('off-hand' as never)
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

  private _applyShieldState() {
    if (!this.bot) {
      return
    }

    if (!this.desiredBlocking) {
      if (this.bot.usingHeldItem) {
        this._lowerShield()
      }
      return
    }

    const bot = this.bot
    this._ensureShieldEquipped().then((equipped) => {
      if (!equipped || !this.desiredBlocking) {
        return
      }

      if (this.currentThreat?.position) {
        this._focusOnThreat(this.currentThreat)
      } else {
        this.lastLookTargetId = null
      }

      if (!bot.usingHeldItem) {
        try {
          bot.activateItem(true)
        } catch (error) {
          console.error('Failed to raise shield', error)
        }
      }
    })
  }

  private _focusOnThreat(entity: Entity) {
    if (this.isManuallyControlled() || !entity?.position || !this.bot?.entity) {
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

    this.bot.lookAt(aim, true).catch(() => {
      /* ignore look failures */
    })
    this.lastLookTargetId = entity.id
    this.nextAllowedLookTime = now + 250
  }

  private _lowerShield() {
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
