import type { Bot, ControlState } from 'mineflayer'

const CONTROLS: ControlState[] = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']
const INPUT_TIMEOUT_MS = 600

export class ManualMovementController {
  private bot: Bot | null
  private active: boolean
  private timeout: ReturnType<typeof setTimeout> | null
  private onStart: (() => void) | undefined

  constructor({ onStart }: { onStart?: () => void } = {}) {
    this.bot = null
    this.active = false
    this.timeout = null
    this.onStart = onStart
  }

  attach(bot: Bot) {
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

  // `raw` comes from the renderer as MovementControls, checked here before use.
  setControls(raw: unknown): { ok: boolean; message?: string } {
    const input = raw as (Record<ControlState, boolean> & { yaw: number; pitch?: number; relative?: boolean }) | null
    if (
      !input ||
      !CONTROLS.every((control) => typeof input[control] === 'boolean') ||
      !Number.isFinite(input.yaw)
    ) {
      return { ok: false, message: 'Invalid movement input.' }
    }
    const bot = this.bot
    if (!bot?.entity || bot.isSleeping) {
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
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = setTimeout(() => this.stop(), INPUT_TIMEOUT_MS)
    try {
      // Resolve camera-relative keys into a heading, then walk forward along it. This keeps
      // the bot facing its travel direction for A/S/D and diagonal movement too.
      // First person keeps facing the view and strafes, like the game.
      const relative = input.relative === true
      if (relative) {
        bot.look(input.yaw, Number.isFinite(input.pitch) ? input.pitch! : bot.entity.pitch, true).catch(() => {})
      } else if (walking) {
        const heading = input.yaw + Math.atan2(left, forward)
        bot.look(heading, 0, true).catch(() => {})
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
        bot.setControlState(control, value)
      }
      return { ok: true }
    } catch {
      this.stop()
      return { ok: false, message: 'Could not move the bot.' }
    }
  }

  stop() {
    if (this.timeout) clearTimeout(this.timeout)
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
