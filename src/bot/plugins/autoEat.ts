import type { Bot } from 'mineflayer'
import type { AutoEatOptions, AutoEatPriority } from '../../types'
import { loader, type EatUtil } from './core/autoEat'
import { ToggleablePlugin } from './toggleablePlugin'

export const PRIORITY_OPTIONS: AutoEatPriority[] = [
  'foodPoints',
  'saturation',
  'effectiveQuality',
  'saturationRatio',
]

export const DEFAULT_OPTIONS: AutoEatOptions = {
  priority: 'foodPoints',
  minHunger: 15,
  minHealth: 14,
  returnToLastItem: true,
  offhand: false,
  eatingTimeout: 3000,
  bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye'],
  strictErrors: true,
}

// `incoming` comes from the renderer (or saved settings), so every field is checked.
export const sanitizeOptions = (
  incoming: unknown = {},
  base: AutoEatOptions = DEFAULT_OPTIONS
): AutoEatOptions => {
  const result: AutoEatOptions = {
    ...base,
    bannedFood: Array.isArray(base.bannedFood) ? [...base.bannedFood] : [...DEFAULT_OPTIONS.bannedFood],
  }

  if (!incoming || typeof incoming !== 'object') {
    return result
  }
  const options = incoming as Record<keyof AutoEatOptions, unknown>

  if (typeof options.priority === 'string' && options.priority.trim().length > 0) {
    const trimmed = options.priority.trim()
    result.priority = PRIORITY_OPTIONS.includes(trimmed as AutoEatPriority)
      ? (trimmed as AutoEatPriority)
      : result.priority
  }

  if (Number.isFinite(Number(options.minHunger))) {
    const value = Number(options.minHunger)
    result.minHunger = Math.max(0, Math.min(20, value))
  }

  if (Number.isFinite(Number(options.minHealth))) {
    const value = Number(options.minHealth)
    result.minHealth = Math.max(0, Math.min(20, value))
  }

  if (typeof options.returnToLastItem === 'boolean') {
    result.returnToLastItem = options.returnToLastItem
  }

  if (typeof options.offhand === 'boolean') {
    result.offhand = options.offhand
  }

  if (Number.isFinite(Number(options.eatingTimeout))) {
    const value = Number(options.eatingTimeout)
    result.eatingTimeout = Math.max(0, value)
  }

  if (Array.isArray(options.bannedFood)) {
    result.bannedFood = (options.bannedFood as unknown[])
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  } else if (typeof options.bannedFood === 'string') {
    result.bannedFood = options.bannedFood
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }

  if (typeof options.strictErrors === 'boolean') {
    result.strictErrors = options.strictErrors
  }

  return result
}

const loadAutoEatPlugin = (bot: Bot | null) => {
  if (!bot) return null
  if (!bot.autoEat) loader(bot)
  return bot.autoEat
}

type EatListeners = Record<
  'eatStart' | 'eatFail' | 'eatFinish',
  (opts?: { food?: { name?: string; displayName?: string } }) => void
>

export class AutoEatController extends ToggleablePlugin {
  private onEating: (food: string | null) => void
  private onResult: (result: { food: string; ok: boolean }) => void
  eating: string | null
  private eatListeners: EatListeners | null
  private spawnListener: (() => void) | null
  private healthListener: (() => void) | null
  private options: AutoEatOptions

  // `onEating` hears what's being eaten when a bite starts, then null when it's done; `onResult` hears
  // { food, ok } after each one.
  constructor({
    onEating = () => {},
    onResult = () => {},
  }: {
    onEating?: (food: string | null) => void
    onResult?: (result: { food: string; ok: boolean }) => void
  } = {}) {
    super()
    this.onEating = onEating
    this.onResult = onResult
    this.eating = null
    this.eatListeners = null
    this.spawnListener = null
    this.healthListener = null
    this.options = { ...DEFAULT_OPTIONS }
  }

  getOptions() {
    return {
      ...this.options,
      bannedFood: [...this.options.bannedFood],
    }
  }

  setOptions(options: unknown = {}) {
    this.options = sanitizeOptions(options, this.options)
    if (this.bot?.autoEat) {
      try {
        this.bot.autoEat.setOpts(this.options)
        if (this.desiredEnabled) {
          this.bot.autoEat.enableAuto()
        }
      } catch (error) {
        console.error('Failed to apply auto eat options', error)
      }
    }
    return this.getOptions()
  }

  protected async _enable() {
    if (!this.bot || this.enabled) {
      return
    }

    const autoEat: EatUtil | null = await loadAutoEatPlugin(this.bot)
    if (!autoEat || !this.bot || !this.desiredEnabled) {
      return
    }

    try {
      this.options = sanitizeOptions({}, this.options)
      autoEat.setOpts(this.options)
      autoEat.enableAuto()
    } catch (error) {
      console.error('Failed to configure auto eat plugin', error)
      return
    }

    this.spawnListener = () => {
      if (!this.desiredEnabled || !this.bot) {
        return
      }

      try {
        autoEat.enableAuto()
      } catch (error) {
        console.error('Failed to enable auto eat after spawn', error)
      }
    }

    this.healthListener = () => {
      if (!this.desiredEnabled || !this.bot) {
        return
      }

      try {
        if (this.bot.food >= 20) {
          autoEat.disableAuto(false)
        } else if (!autoEat.enabled) {
          autoEat.enableAuto()
        }
      } catch (error) {
        console.error('Failed to update auto eat state on health change', error)
      }
    }

    this.bot.on('spawn', this.spawnListener)
    this.bot.on('health', this.healthListener)

    // Eating takes a couple of seconds and the plugin finishes (even after a failure) with eatFinish.
    let failed = false
    const foodName = (opts?: { food?: { name?: string; displayName?: string } }) =>
      opts?.food?.displayName ?? opts?.food?.name ?? 'food'
    this.eatListeners = {
      eatStart: (opts) => {
        failed = false
        this.eating = foodName(opts)
        this.onEating(this.eating)
      },
      eatFail: () => {
        failed = true
      },
      eatFinish: (opts) => {
        const food = this.eating ?? foodName(opts)
        this.eating = null
        this.onEating(null)
        this.onResult({ food, ok: !failed })
      },
    }
    for (const [event, listener] of Object.entries(this.eatListeners))
      autoEat.on(event as never, listener as never)

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

    if (this.healthListener) {
      this.bot.removeListener('health', this.healthListener)
      this.healthListener = null
    }

    const { autoEat } = this.bot
    if (autoEat && this.eatListeners) {
      for (const [event, listener] of Object.entries(this.eatListeners)) {
        autoEat.removeListener(event as never, listener as never)
      }
    }
    this.eatListeners = null
    if (this.eating) {
      this.eating = null
      this.onEating(null)
    }
    if (autoEat) {
      try {
        autoEat.disableAuto()
      } catch (error) {
        console.error('Failed to disable auto eat plugin', error)
      }
    }

    this.enabled = false
  }
}
