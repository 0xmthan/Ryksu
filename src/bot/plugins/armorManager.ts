import type { Bot } from 'mineflayer'
import { initializeBot as loadArmorManagerPlugin } from './core/armor'

type Listener = (...args: unknown[]) => void

export class ArmorManagerController {
  private bot: Bot | null
  private enabled: boolean
  private desiredEnabled: boolean
  private playerCollectListener: Listener | null | undefined
  private spawnListener: (() => void) | null

  constructor() {
    this.bot = null
    this.enabled = false
    this.desiredEnabled = false
    this.playerCollectListener = null
    this.spawnListener = null
  }

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

  private async _equipAllSafe(context: string) {
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

  private _enable() {
    if (!this.bot || this.enabled) {
      return
    }

    const { bot } = this
    const previousListeners = bot.listeners('playerCollect') as Listener[]

    try {
      loadArmorManagerPlugin(bot)
    } catch (error) {
      console.error('Failed to load armor manager plugin', error)
      return
    }

    const currentListeners = bot.listeners('playerCollect') as Listener[]
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

  private _disable() {
    if (!this.bot || !this.enabled) {
      return
    }

    if (this.spawnListener) {
      this.bot.removeListener('spawn', this.spawnListener)
      this.spawnListener = null
    }

    if (this.playerCollectListener) {
      this.bot.removeListener('playerCollect', this.playerCollectListener as never)
      this.playerCollectListener = null
    }

    if (this.bot.armorManager) {
      delete (this.bot as Partial<Bot>).armorManager
    }

    this.enabled = false
  }
}
