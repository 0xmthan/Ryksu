// Lets trusted players control the bot with in-game movement:
// hold sneak and jump GESTURE_JUMPS times within GESTURE_WINDOW_MS to make the bot follow you, again to stop.
import type { Bot } from 'mineflayer'
import type { Entity } from 'prismarine-entity'

type JumpState = { wasOnGround: boolean | null; lastY: number | null; jumpTimes: number[]; cooldownUntil: number }

const GESTURE_JUMPS = 3
const GESTURE_WINDOW_MS = 3000
const GESTURE_COOLDOWN_MS = 2000

const RELATIVE_MOVE_PACKETS = ['rel_entity_move', 'entity_move_look']

export class GestureController {
  private isTrusted: (name: string | undefined) => boolean
  private onGesture: (entity: Entity) => void
  private bot: Bot | null
  private tracked: Map<number, JumpState>

  constructor({
    isTrusted,
    onGesture,
  }: {
    isTrusted: (name: string | undefined) => boolean
    onGesture: (entity: Entity) => void
  }) {
    this.isTrusted = isTrusted
    this.onGesture = onGesture
    this.bot = null
    // Jump tracking per player entity id.
    this.tracked = new Map()
    this._handleRelativeMove = this._handleRelativeMove.bind(this)
    this._handleSyncPosition = this._handleSyncPosition.bind(this)
  }

  attach(bot: Bot) {
    this.bot = bot
    this.tracked.clear()
    for (const name of RELATIVE_MOVE_PACKETS) {
      bot._client.on(name, this._handleRelativeMove)
    }
    bot._client.on('sync_entity_position', this._handleSyncPosition)
  }

  detach() {
    if (this.bot) {
      for (const name of RELATIVE_MOVE_PACKETS) {
        this.bot._client.removeListener(name, this._handleRelativeMove)
      }
      this.bot._client.removeListener('sync_entity_position', this._handleSyncPosition)
    }
    this.bot = null
    this.tracked.clear()
  }

  private _handleRelativeMove(packet: { entityId: number; onGround: boolean; dY: number }) {
    this._handleMovement(packet.entityId, packet.onGround, () => packet.dY > 0)
  }

  private _handleSyncPosition(packet: { entityId: number; onGround: boolean; y: number }) {
    this._handleMovement(packet.entityId, packet.onGround, (state) => state.lastY !== null && packet.y > state.lastY, packet.y)
  }

  private _handleMovement(
    entityId: number,
    onGround: boolean,
    isRising: (state: JumpState) => boolean,
    y: number | null = null
  ) {
    const entity = this.bot?.entities?.[entityId]
    if (!entity || entity.type !== 'player' || entity === this.bot?.entity || !this.isTrusted(entity.username)) {
      return
    }

    let state = this.tracked.get(entityId)
    if (!state) {
      state = { wasOnGround: null, lastY: null, jumpTimes: [], cooldownUntil: 0 }
      this.tracked.set(entityId, state)
    }
    const tookOff = state.wasOnGround === true && onGround === false && isRising(state)
    state.wasOnGround = onGround
    if (y !== null) state.lastY = y
    if (!tookOff || !(entity as Entity & { crouching?: boolean }).crouching) {
      return
    }

    const now = Date.now()
    if (now < state.cooldownUntil) {
      return
    }

    state.jumpTimes = state.jumpTimes.filter((time) => now - time <= GESTURE_WINDOW_MS)
    state.jumpTimes.push(now)
    if (state.jumpTimes.length >= GESTURE_JUMPS) {
      state.jumpTimes = []
      state.cooldownUntil = now + GESTURE_COOLDOWN_MS
      this.onGesture(entity)
      // Visible acknowledgement for the player who made the gesture.
      this.bot?.swingArm?.('right')
    }
  }
}
