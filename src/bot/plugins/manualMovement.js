const CONTROLS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']
const INPUT_TIMEOUT_MS = 600

class ManualMovementController {
  constructor({ onStart } = {}) {
    this.bot = null
    this.active = false
    this.timeout = null
    this.onStart = onStart
  }

  attach(bot) {
    this.detach()
    this.bot = bot
  }

  detach() {
    this.stop()
    this.bot = null
  }

  isActive() {
    return this.active
  }

  setControls(input) {
    if (
      !input ||
      !CONTROLS.every((control) => typeof input[control] === 'boolean') ||
      !Number.isFinite(input.yaw)
    ) {
      return { ok: false, message: 'Invalid movement input.' }
    }
    if (!this.bot?.entity || this.bot.isSleeping) {
      this.stop()
      return { ok: false, message: 'The bot cannot move right now.' }
    }
    const forward = Number(input.forward) - Number(input.back)
    const left = Number(input.left) - Number(input.right)
    const walking = forward !== 0 || left !== 0
    if (!walking && !input.jump && !input.sneak) {
      this.stop()
      return { ok: true }
    }
    if (!this.active) {
      this.onStart?.()
      this.active = true
    }
    clearTimeout(this.timeout)
    this.timeout = setTimeout(() => this.stop(), INPUT_TIMEOUT_MS)
    try {
      // Resolve camera-relative keys into a heading, then walk forward along it. This keeps
      // the bot facing its travel direction for A/S/D and diagonal movement too.
      // First person keeps facing the view and strafes, like the game.
      const relative = input.relative === true
      if (relative) {
        this.bot.look(input.yaw, Number.isFinite(input.pitch) ? input.pitch : this.bot.entity.pitch, true).catch(() => {})
      } else if (walking) {
        const heading = input.yaw + Math.atan2(left, forward)
        this.bot.look(heading, 0, true).catch(() => {})
      }
      for (const control of CONTROLS) {
        const value =
          control === 'sprint'
            ? input.sprint && (relative ? forward > 0 : walking) && !input.sneak
            : control === 'sneak'
              ? input.sneak
              : control === 'jump'
                ? input.jump
                : relative
                  ? input[control]
                  : control === 'forward' && walking
        this.bot.setControlState(control, value)
      }
      return { ok: true }
    } catch {
      this.stop()
      return { ok: false, message: 'Could not move the bot.' }
    }
  }

  stop() {
    clearTimeout(this.timeout)
    this.timeout = null
    if (this.active && this.bot) {
      for (const control of CONTROLS) {
        try {
          this.bot.setControlState(control, false)
        } catch {}
      }
    }
    this.active = false
  }
}

module.exports = { ManualMovementController }
