const loadArmorManagerPlugin = require('mineflayer-armor-manager')

class ArmorManagerController {
  constructor() {
    this.bot = null
    this.enabled = false
    this.desiredEnabled = false
    this.playerCollectListener = null
    this.spawnListener = null
  }

  attach(bot) {
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

  async _equipAllSafe(context) {
    if (!this.bot || !this.desiredEnabled || !this.bot.armorManager?.equipAll) {
      return
    }

    const hasInventory =
      this.bot.inventory && typeof this.bot.inventory.items === 'function'

    if (!hasInventory) {
      return
    }

    try {
      await this.bot.armorManager.equipAll()
    } catch (error) {
      console.error(`Failed to equip armor (${context})`, error)
    }
  }

  _enable() {
    if (!this.bot || this.enabled) {
      return
    }

    const { bot } = this
    const previousListeners = bot.listeners('playerCollect')

    try {
      loadArmorManagerPlugin(bot)
    } catch (error) {
      console.error('Failed to load armor manager plugin', error)
      return
    }

    const currentListeners = bot.listeners('playerCollect')
    this.playerCollectListener = currentListeners.find(
      (listener) => !previousListeners.includes(listener)
    )

    this.spawnListener = () => {
      if (!this.desiredEnabled) {
        return
      }
      setTimeout(() => {
        this._equipAllSafe('spawn')
      }, 100)
    }

    bot.on('spawn', this.spawnListener)

    this._equipAllSafe('enable')

    this.enabled = true
  }

  _disable() {
    if (!this.bot || !this.enabled) {
      return
    }

    if (this.spawnListener) {
      this.bot.removeListener('spawn', this.spawnListener)
      this.spawnListener = null
    }

    if (this.playerCollectListener) {
      this.bot.removeListener('playerCollect', this.playerCollectListener)
      this.playerCollectListener = null
    }

    if (this.bot.armorManager) {
      delete this.bot.armorManager
    }

    this.enabled = false
  }
}

module.exports = { ArmorManagerController }
