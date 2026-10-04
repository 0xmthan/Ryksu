const PRIORITY_OPTIONS = ['foodPoints', 'saturation', 'effectiveQuality', 'saturationRatio']

const DEFAULT_OPTIONS = {
  priority: 'foodPoints',
  minHunger: 15,
  minHealth: 14,
  returnToLastItem: true,
  offhand: false,
  eatingTimeout: 3000,
  bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye'],
  strictErrors: true,
}

const sanitizeOptions = (incoming = {}, base = DEFAULT_OPTIONS) => {
  const result = {
    ...base,
    bannedFood: Array.isArray(base.bannedFood) ? [...base.bannedFood] : [...DEFAULT_OPTIONS.bannedFood],
  }

  if (!incoming || typeof incoming !== 'object') {
    return result
  }

  if (typeof incoming.priority === 'string' && incoming.priority.trim().length > 0) {
    const trimmed = incoming.priority.trim()
    result.priority = PRIORITY_OPTIONS.includes(trimmed) ? trimmed : result.priority
  }

  if (Number.isFinite(Number(incoming.minHunger))) {
    const value = Number(incoming.minHunger)
    result.minHunger = Math.max(0, Math.min(20, value))
  }

  if (Number.isFinite(Number(incoming.minHealth))) {
    const value = Number(incoming.minHealth)
    result.minHealth = Math.max(0, Math.min(20, value))
  }

  if (typeof incoming.returnToLastItem === 'boolean') {
    result.returnToLastItem = incoming.returnToLastItem
  }

  if (typeof incoming.offhand === 'boolean') {
    result.offhand = incoming.offhand
  }

  if (Number.isFinite(Number(incoming.eatingTimeout))) {
    const value = Number(incoming.eatingTimeout)
    result.eatingTimeout = Math.max(0, value)
  }

  if (Array.isArray(incoming.bannedFood)) {
    result.bannedFood = incoming.bannedFood
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  } else if (typeof incoming.bannedFood === 'string') {
    result.bannedFood = incoming.bannedFood
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }

  if (typeof incoming.strictErrors === 'boolean') {
    result.strictErrors = incoming.strictErrors
  }

  return result
}

let loadAutoEatPluginPromise = null

const loadAutoEatPlugin = async (bot) => {
  if (!bot) {
    return null
  }

  if (bot.autoEat) {
    return bot.autoEat
  }

  if (!loadAutoEatPluginPromise) {
    loadAutoEatPluginPromise = import('mineflayer-auto-eat')
      .then((module) => {
        const loader = module?.loader ?? module?.default ?? module
        if (typeof loader !== 'function') {
          throw new Error('mineflayer-auto-eat plugin loader is not a function')
        }
        loader(bot)
        return bot.autoEat ?? null
      })
      .catch((error) => {
        console.error('Failed to load auto eat plugin', error)
        return null
      })
      .finally(() => {
        loadAutoEatPluginPromise = null
      })
  }

  const autoEat = await loadAutoEatPluginPromise
  return autoEat ?? null
}

class AutoEatController {
  // `onEating` hears what's being eaten when a bite starts, then null when it's done; `onResult` hears
  // { food, ok } after each one.
  constructor({ onEating = () => {}, onResult = () => {} } = {}) {
    this.onEating = onEating
    this.onResult = onResult
    this.eating = null
    this.eatListeners = null
    this.bot = null
    this.enabled = false
    this.desiredEnabled = false
    this.spawnListener = null
    this.healthListener = null
    this.options = { ...DEFAULT_OPTIONS }
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

  getOptions() {
    return {
      ...this.options,
      bannedFood: [...this.options.bannedFood],
    }
  }

  setOptions(options = {}) {
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

  async _enable() {
    if (!this.bot || this.enabled) {
      return
    }

    const autoEat = await loadAutoEatPlugin(this.bot)
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
          autoEat.disableAuto()
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
    const foodName = (opts) => opts?.food?.displayName ?? opts?.food?.name ?? 'food'
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
    for (const [event, listener] of Object.entries(this.eatListeners)) autoEat.on(event, listener)

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

    if (this.healthListener) {
      this.bot.removeListener('health', this.healthListener)
      this.healthListener = null
    }

    const { autoEat } = this.bot
    if (autoEat && this.eatListeners) {
      for (const [event, listener] of Object.entries(this.eatListeners)) autoEat.removeListener(event, listener)
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

module.exports = { AutoEatController, DEFAULT_OPTIONS, sanitizeOptions, PRIORITY_OPTIONS }
