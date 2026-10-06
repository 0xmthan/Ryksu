import type { Bot } from 'mineflayer'
import { initializeBot as loadArmorManagerPlugin } from './core/armor'
import { ToggleablePlugin } from './toggleablePlugin'

type Listener = (...args: unknown[]) => void

export class ArmorManagerController extends ToggleablePlugin {
  private playerCollectListener: Listener | null | undefined
  private spawnListener: (() => void) | null

  constructor() {
    super()
    this.playerCollectListener = null
    this.spawnListener = null
  }

  private async _equipAllSafe(context: string) {
    if (!this.bot || !this.desiredEnabled || !this.bot.armorManager?.equipAll) {
      return
    }

    const hasInventory = this.bot.inventory && typeof this.bot.inventory.items === 'function'

    if (!hasInventory) {
      return
    }

    try {
      await this.bot.armorManager.equipAll()
    } catch (error) {
      console.error(`Failed to equip armor (${context})`, error)
    }
  }

  protected _enable() {
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
    this.playerCollectListener = currentListeners.find((listener) => !previousListeners.includes(listener))

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

  protected _disable() {
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
