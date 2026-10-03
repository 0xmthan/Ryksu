// Lets the follow target control the bot with in-game movement:
// hold sneak and jump GESTURE_JUMPS times within GESTURE_WINDOW_MS to toggle following.
const GESTURE_JUMPS = 3
const GESTURE_WINDOW_MS = 3000
const GESTURE_COOLDOWN_MS = 2000

const RELATIVE_MOVE_PACKETS = ['rel_entity_move', 'entity_move_look']

class GestureController {
  constructor({ getTargetName, onToggleFollow }) {
    this.getTargetName = getTargetName
    this.onToggleFollow = onToggleFollow
    this.bot = null
    this.wasOnGround = null
    this.lastY = null
    this.jumpTimes = []
    this.cooldownUntil = 0
    this._handleRelativeMove = this._handleRelativeMove.bind(this)
    this._handleSyncPosition = this._handleSyncPosition.bind(this)
  }

  attach(bot) {
    this.bot = bot
    this._reset()
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
    this._reset()
  }

  _handleRelativeMove(packet) {
    this._handleMovement(packet.entityId, packet.onGround, packet.dY > 0)
  }

  _handleSyncPosition(packet) {
    const rising = this.lastY !== null && packet.y > this.lastY
    this._handleMovement(packet.entityId, packet.onGround, rising)
    if (this._targetEntity()?.id === packet.entityId) {
      this.lastY = packet.y
    }
  }

  _handleMovement(entityId, onGround, rising) {
    const target = this._targetEntity()
    if (!target || target.id !== entityId) {
      return
    }

    const tookOff = this.wasOnGround === true && onGround === false && rising
    this.wasOnGround = onGround
    if (!tookOff || !target.crouching) {
      return
    }

    const now = Date.now()
    if (now < this.cooldownUntil) {
      return
    }

    this.jumpTimes = this.jumpTimes.filter((time) => now - time <= GESTURE_WINDOW_MS)
    this.jumpTimes.push(now)
    if (this.jumpTimes.length >= GESTURE_JUMPS) {
      this.jumpTimes = []
      this.cooldownUntil = now + GESTURE_COOLDOWN_MS
      this.onToggleFollow()
      // Visible acknowledgement for the player who made the gesture.
      this.bot?.swingArm?.()
    }
  }

  _targetEntity() {
    const name = this.getTargetName()?.trim()
    if (!name || !this.bot) {
      return null
    }
    return this.bot.players?.[name]?.entity ?? null
  }

  _reset() {
    this.wasOnGround = null
    this.lastY = null
    this.jumpTimes = []
    this.cooldownUntil = 0
  }
}

module.exports = { GestureController }
