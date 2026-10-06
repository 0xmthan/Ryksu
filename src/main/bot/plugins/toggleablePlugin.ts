import type { Bot } from 'mineflayer'

// A plugin the user turns on and off from the toolbar. The choice outlives the bot: it's applied to each new
// bot on attach. Subclasses hook into the bot in `_enable` and undo it all in `_disable`, setting `enabled`.
export abstract class ToggleablePlugin {
  protected bot: Bot | null = null
  // What the user picked.
  protected desiredEnabled = false
  // Whether it's hooked into the current bot.
  protected enabled = false

  attach(bot: Bot) {
    this.bot = bot
    if (this.desiredEnabled) {
      this._enable()
    }
  }

  detach() {
    if (this.bot) {
      this._disable()
    }
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

  protected abstract _enable(): void

  protected abstract _disable(): void
}
