// Creepers. A creeper the bot was told to fight gets hit and backed away from, in rhythm with the weapon's
// recharge, so it never stands close long enough to blow. Any creeper that's hissing, or right on top of
// the bot, gets backed away from while the bot keeps its eyes on it; if the fuse is nearly out the
// shield goes up (a raised shield takes the whole blast from the front).
//
// The game: a creeper starts hissing when its target is within 3 blocks, gives up beyond 7, and blows
// 30 ticks (1.5 s) into a hiss. Its swell_dir metadata says which way the fuse is going, so the fuse is
// counted here the same way the game does.
//
// While it's in charge this steers the bot directly every tick (the pathfinder is far too slow to dance
// with a creeper), and tells the PvP and shield plugins to stand aside through isFleeing().

import type { Bot } from 'mineflayer'
import type { Entity } from 'prismarine-entity'
import type { AutoToolController } from './autoTool'
import type { PathfinderController } from './pathfinder'
import type { PvpController } from './pvp'

type Steer = 'forward' | 'back' | null

const FUSE_TICKS = 30
// With this little fuse left the bot can't outwalk the blast, so the shield goes up.
const LATE_TICKS = 12
// Center to center: just inside attack reach, and about where creepers start to hiss.
const STRIKE_DISTANCE = 3.2
// Where the bot waits while its weapon recharges.
const WAIT_DISTANCE = 4.6
// Inside this the fight steers the bot itself; further out the PvP plugin walks it in.
const ENGAGE_DISTANCE = 7
// A blast hurts inside this.
const BLAST_DISTANCE = 6
// Creepers stop hissing past 7 blocks; untargeted ones are backed away from until this far.
const CLEAR_DISTANCE = 7.5
// An untargeted creeper this close gets backed away from even before it hisses.
const TOO_CLOSE = 3
const TRACK_DISTANCE = 16
const FOLLOW_PAUSE_MS = 1000

export class CreeperWatch {
  private pathfinder: PathfinderController
  private pvp: PvpController
  private autoTool: AutoToolController
  private onAlert: ((message: string) => void) | undefined
  private isManuallyControlled: () => boolean
  private bot: Bot | null
  private engaged: boolean
  private fuses: Map<number, number>
  private cooldown: number
  private shieldUp: boolean
  private alerted: WeakSet<Entity>

  constructor({
    pathfinder,
    pvp,
    autoTool,
    onAlert,
    isManuallyControlled = () => false,
  }: {
    pathfinder: PathfinderController
    pvp: PvpController
    autoTool: AutoToolController
    onAlert?: (message: string) => void
    isManuallyControlled?: () => boolean
  }) {
    this.pathfinder = pathfinder
    this.pvp = pvp
    this.autoTool = autoTool
    this.onAlert = onAlert
    this.isManuallyControlled = isManuallyControlled
    this.bot = null
    this.engaged = false
    this.fuses = new Map()
    this.cooldown = 0
    this.shieldUp = false
    this.alerted = new WeakSet()
    this._handleTick = this._handleTick.bind(this)
  }

  attach(bot: Bot) {
    this.bot = bot
    this.engaged = false
    this.fuses.clear()
    bot.on('physicsTick', this._handleTick)
  }

  detach() {
    this._release()
    this.bot?.removeListener('physicsTick', this._handleTick)
    this.bot = null
  }

  // True while a creeper has the bot's controls; the PvP plugin and auto shield stay out of the way.
  isFleeing() {
    return this.engaged
  }

  private _handleTick() {
    const bot = this.bot
    if (!bot?.entity || bot.isSleeping || this.isManuallyControlled()) {
      this._release()
      return
    }
    if (this.cooldown > 0) this.cooldown--
    this._countFuses()

    const target = this._fightTarget()
    if (target) {
      const distance = this._distance(target)
      // A fuse that's still draining keeps the bot back too: walking in early meets a short fuse.
      if (distance <= ENGAGE_DISTANCE || this._hissing(target) || this._fuseCharged(target)) {
        this._engage()
        this._fight(target, distance)
        return
      }
      // Too far yet: the PvP plugin walks it in.
      this._release()
      return
    }

    const threat = this._threat()
    if (threat) {
      this._engage()
      this._evade(threat, this._distance(threat))
      return
    }
    this._release()
  }

  // Mirrors the game's fuse: up a tick while hissing, down a tick while calming, 0 to 30.
  private _countFuses() {
    const seen = new Set<number>()
    for (const entity of Object.values(this.bot!.entities)) {
      if (entity?.name !== 'creeper' || !entity.isValid || this._distance(entity) > TRACK_DISTANCE) continue
      seen.add(entity.id)
      const swell = this.fuses.get(entity.id) ?? 0
      const direction = this._swellDirection(entity)
      this.fuses.set(entity.id, Math.max(0, Math.min(FUSE_TICKS, swell + (direction > 0 ? 1 : -1))))
    }
    for (const id of this.fuses.keys()) if (!seen.has(id)) this.fuses.delete(id)
  }

  private _swellDirection(creeper: Entity) {
    const keys = this.bot!.registry.entitiesByName?.creeper?.metadataKeys
    const read = (key: string): unknown => {
      const index = Array.isArray(keys) ? keys.indexOf(key) : -1
      return index >= 0 ? creeper.metadata?.[index] : undefined
    }
    // Lit with flint and steel: hisses no matter what.
    if (read('is_ignited') === true) return 1
    return Number(read('swell_dir') ?? -1)
  }

  private _hissing(creeper: Entity) {
    return this._swellDirection(creeper) > 0
  }

  private _fuseLeft(creeper: Entity) {
    return FUSE_TICKS - (this.fuses.get(creeper.id) ?? 0)
  }

  private _fuseCharged(creeper: Entity) {
    return (this.fuses.get(creeper.id) ?? 0) > 0
  }

  private _distance(entity: Entity) {
    return entity.position.distanceTo(this.bot!.entity.position)
  }

  private _fightTarget(): Entity | null {
    const target = this.pvp.target ?? this.pvp.defendTarget
    return target?.name === 'creeper' && target.isValid ? target : null
  }

  // The nearest creeper worth backing away from: hissing nearby, or right on top of the bot.
  private _threat() {
    let nearest: Entity | null = null
    let nearestDistance = Infinity
    for (const entity of Object.values(this.bot!.entities)) {
      if (entity?.name !== 'creeper' || !entity.isValid) continue
      const distance = this._distance(entity)
      const dangerous = distance <= TOO_CLOSE || (this._hissing(entity) && distance < CLEAR_DISTANCE)
      if (dangerous && distance < nearestDistance) {
        nearest = entity
        nearestDistance = distance
      }
    }
    return nearest
  }

  private _engage() {
    this.pathfinder.pauseFollow(FOLLOW_PAUSE_MS)
    if (this.engaged) return
    this.engaged = true
    try {
      this.bot!.pathfinder?.setGoal(null)
    } catch {
      // Not moving anyway.
    }
    this._readyShield()
    if (this._fightTarget() && this.autoTool?.isEnabled?.()) this.autoTool.equipBestWeapon?.().catch(() => {})
  }

  private _release() {
    if (!this.engaged) return
    this.engaged = false
    this._steer(null)
    this._lowerShield()
    this.pathfinder.resumeFollow()
  }

  // Hit it when the weapon's ready, wait out the recharge just out of reach, and back off once it hisses.
  private _fight(creeper: Entity, distance: number) {
    this._face(creeper)
    if (this._hissing(creeper)) {
      const left = this._fuseLeft(creeper)
      if (!this.alerted.has(creeper)) {
        this.alerted.add(creeper)
        this.onAlert?.('Creeper hissing, backing off.')
      }
      // A last hit while there's time knocks it further off as the bot backs away.
      if (this.cooldown === 0 && distance <= STRIKE_DISTANCE && left > LATE_TICKS) this._attack(creeper)
      this._guard(left, distance)
      this._steer('back')
      return
    }
    this._lowerShield()
    // Wait out a fuse that's still draining from the last hiss before going back in.
    if (this._fuseCharged(creeper)) {
      this._steer(distance < CLEAR_DISTANCE ? 'back' : null)
      return
    }
    if (this.cooldown === 0) {
      // Sprint in: a sprinting hit knocks it back further. Then straight back out.
      if (distance > STRIKE_DISTANCE) {
        this._steer('forward', true)
      } else {
        this._attack(creeper)
        this._steer('back')
      }
      return
    }
    if (distance < WAIT_DISTANCE) this._steer('back')
    else if (distance > WAIT_DISTANCE + 1.5) this._steer('forward')
    else this._steer(null)
  }

  // Back away from a creeper the bot isn't fighting until it's out of range.
  private _evade(creeper: Entity, distance: number) {
    this._face(creeper)
    if (this._hissing(creeper) && !this.alerted.has(creeper)) {
      this.alerted.add(creeper)
      this.onAlert?.('Creeper hissing nearby, backing off.')
    }
    if (this._hissing(creeper)) this._guard(this._fuseLeft(creeper), distance)
    else this._lowerShield()
    this._steer('back')
  }

  // Shield up only when the blast is coming (holding it slows walking to a crawl), and kept up until the
  // hiss stops or the creeper's out of range.
  private _guard(fuseLeft: number, distance: number) {
    if (fuseLeft <= LATE_TICKS && distance < BLAST_DISTANCE) this._raiseShield()
    else if (!this.shieldUp || distance >= CLEAR_DISTANCE) this._lowerShield()
  }

  private _attack(creeper: Entity) {
    this.bot!.attack(creeper)
    const held = this.bot!.heldItem?.name ?? 'other'
    this.cooldown = this.pvp.cooldownTicksFor(held) + 2
    this.bot!.setControlState('sprint', false)
  }

  private _face(creeper: Entity) {
    this.bot!.lookAt(creeper.position.offset(0, 1.1, 0), true).catch(() => {})
  }

  // 'forward', 'back' or null (stand). Hops over a block in the way.
  private _steer(direction: Steer, sprint = false) {
    const bot = this.bot
    if (!bot) return
    bot.setControlState('forward', direction === 'forward')
    bot.setControlState('back', direction === 'back')
    bot.setControlState('sprint', direction === 'forward' && sprint)
    bot.setControlState('jump', Boolean(direction) && Boolean(bot.entity?.isCollidedHorizontally))
  }

  private _offhand() {
    return this.bot!.inventory.slots[this.bot!.getEquipmentDestSlot('off-hand' as never)]
  }

  // Moves a shield to an empty off hand when the fight starts (never over a totem or anything else).
  private _readyShield() {
    if (this._offhand()) return
    const shield = this.bot!.inventory.items().find((item) => item.name === 'shield')
    if (shield) this.bot!.equip(shield, 'off-hand').catch(() => {})
  }

  private _raiseShield() {
    if (this.shieldUp || this._offhand()?.name !== 'shield') return
    this.shieldUp = true
    this.bot!.activateItem(true)
  }

  private _lowerShield() {
    if (!this.shieldUp) return
    this.shieldUp = false
    this.bot?.deactivateItem()
  }
}
