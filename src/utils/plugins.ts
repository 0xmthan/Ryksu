import type { AutoEatOptions, AutoEatPriority, PathfinderOptions, PvpOptions } from '../types'

export const AUTO_EAT_DEFAULTS: AutoEatOptions = {
  priority: 'foodPoints',
  minHunger: 15,
  minHealth: 14,
  returnToLastItem: true,
  offhand: false,
  eatingTimeout: 3000,
  bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye'],
  strictErrors: true,
}

const AUTO_EAT_PRIORITIES: AutoEatPriority[] = [
  'foodPoints',
  'saturation',
  'effectiveQuality',
  'saturationRatio',
]

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum)

const normalizeAutoEatOptions = (incoming?: Partial<AutoEatOptions>): AutoEatOptions => {
  if (!incoming || typeof incoming !== 'object') {
    return { ...AUTO_EAT_DEFAULTS }
  }

  const priority =
    typeof incoming.priority === 'string' && AUTO_EAT_PRIORITIES.includes(incoming.priority)
      ? incoming.priority
      : AUTO_EAT_DEFAULTS.priority

  const minHunger = Number.isFinite(Number(incoming.minHunger))
    ? clamp(Number(incoming.minHunger), 0, 20)
    : AUTO_EAT_DEFAULTS.minHunger

  const minHealth = Number.isFinite(Number(incoming.minHealth))
    ? clamp(Number(incoming.minHealth), 0, 20)
    : AUTO_EAT_DEFAULTS.minHealth

  const returnToLastItem =
    typeof incoming.returnToLastItem === 'boolean'
      ? incoming.returnToLastItem
      : AUTO_EAT_DEFAULTS.returnToLastItem

  const offhand = typeof incoming.offhand === 'boolean' ? incoming.offhand : AUTO_EAT_DEFAULTS.offhand

  const eatingTimeout = Number.isFinite(Number(incoming.eatingTimeout))
    ? Math.max(0, Number(incoming.eatingTimeout))
    : AUTO_EAT_DEFAULTS.eatingTimeout

  const bannedFoodRaw = (incoming as { bannedFood?: unknown }).bannedFood
  let bannedFoodCandidates: string[]
  if (Array.isArray(bannedFoodRaw) && bannedFoodRaw.length > 0) {
    bannedFoodCandidates = bannedFoodRaw.filter((entry): entry is string => typeof entry === 'string')
  } else if (typeof bannedFoodRaw === 'string') {
    bannedFoodCandidates = bannedFoodRaw.split(',').map((entry) => entry.trim())
  } else {
    bannedFoodCandidates = [...AUTO_EAT_DEFAULTS.bannedFood]
  }

  const bannedFood = bannedFoodCandidates.map((entry) => entry.trim()).filter((entry) => entry.length > 0)

  const strictErrors =
    typeof incoming.strictErrors === 'boolean' ? incoming.strictErrors : AUTO_EAT_DEFAULTS.strictErrors

  return {
    priority,
    minHunger,
    minHealth,
    returnToLastItem,
    offhand,
    eatingTimeout,
    bannedFood,
    strictErrors,
  }
}

export type PluginPreferences = {
  armorManagerEnabled: boolean
  autoEatEnabled: boolean
  autoEatOptions: AutoEatOptions
  pathfinder: PathfinderOptions
  pvp: PvpOptions
}

const DEFAULT_PLUGIN_PREFERENCES: PluginPreferences = {
  armorManagerEnabled: false,
  autoEatEnabled: false,
  autoEatOptions: AUTO_EAT_DEFAULTS,
  pathfinder: { followEnabled: false, followTarget: '', goToLocation: undefined },
  pvp: {
    mobEnabled: false,
    playerEnabled: false,
    playerTarget: '',
    mobMovementEnabled: true,
    allowBlockBreak: true,
  },
}

const STORAGE_KEY = 'ryksu:pluginPreferences'

export const loadPluginPreferences = (): PluginPreferences => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        ...DEFAULT_PLUGIN_PREFERENCES,
        autoEatOptions: { ...AUTO_EAT_DEFAULTS },
        pathfinder: { ...DEFAULT_PLUGIN_PREFERENCES.pathfinder },
        pvp: { ...DEFAULT_PLUGIN_PREFERENCES.pvp },
      }
    }

    const parsed = JSON.parse(raw) as Partial<PluginPreferences>

    return {
      armorManagerEnabled:
        typeof parsed.armorManagerEnabled === 'boolean'
          ? parsed.armorManagerEnabled
          : DEFAULT_PLUGIN_PREFERENCES.armorManagerEnabled,
      autoEatEnabled:
        typeof parsed.autoEatEnabled === 'boolean'
          ? parsed.autoEatEnabled
          : DEFAULT_PLUGIN_PREFERENCES.autoEatEnabled,
      autoEatOptions: normalizeAutoEatOptions(parsed.autoEatOptions),
      pathfinder:
        parsed.pathfinder && typeof parsed.pathfinder === 'object'
          ? {
              followEnabled: Boolean((parsed.pathfinder as PathfinderOptions).followEnabled),
              followTarget: String((parsed.pathfinder as PathfinderOptions).followTarget ?? '').trim(),
            }
          : { ...DEFAULT_PLUGIN_PREFERENCES.pathfinder },
      pvp:
        parsed.pvp && typeof parsed.pvp === 'object'
          ? {
              mobEnabled: Boolean((parsed.pvp as PvpOptions).mobEnabled),
              playerEnabled: Boolean((parsed.pvp as PvpOptions).playerEnabled),
              playerTarget: String((parsed.pvp as PvpOptions).playerTarget ?? '').trim(),
              mobMovementEnabled:
                typeof (parsed.pvp as PvpOptions).mobMovementEnabled === 'boolean'
                  ? (parsed.pvp as PvpOptions).mobMovementEnabled
                  : DEFAULT_PLUGIN_PREFERENCES.pvp.mobMovementEnabled,
              allowBlockBreak:
                typeof (parsed.pvp as PvpOptions).allowBlockBreak === 'boolean'
                  ? (parsed.pvp as PvpOptions).allowBlockBreak
                  : DEFAULT_PLUGIN_PREFERENCES.pvp.allowBlockBreak,
            }
          : { ...DEFAULT_PLUGIN_PREFERENCES.pvp },
    }
  } catch (error) {
    console.error('Failed to load plugin preferences', error)
    return {
      ...DEFAULT_PLUGIN_PREFERENCES,
      autoEatOptions: { ...AUTO_EAT_DEFAULTS },
      pathfinder: { ...DEFAULT_PLUGIN_PREFERENCES.pathfinder },
      pvp: { ...DEFAULT_PLUGIN_PREFERENCES.pvp },
    }
  }
}

export const savePluginPreferences = (preferences: PluginPreferences) => {
  const payload: PluginPreferences = {
    armorManagerEnabled: preferences.armorManagerEnabled,
    autoEatEnabled: preferences.autoEatEnabled,
    autoEatOptions: normalizeAutoEatOptions(preferences.autoEatOptions),
    pathfinder: {
      followEnabled: Boolean(preferences.pathfinder?.followEnabled),
      followTarget: String(preferences.pathfinder?.followTarget ?? '').trim(),
    },
    pvp: {
      mobEnabled: Boolean(preferences.pvp?.mobEnabled),
      playerEnabled: Boolean(preferences.pvp?.playerEnabled),
      playerTarget: String(preferences.pvp?.playerTarget ?? '').trim(),
      mobMovementEnabled:
        typeof preferences.pvp?.mobMovementEnabled === 'boolean'
          ? preferences.pvp.mobMovementEnabled
          : DEFAULT_PLUGIN_PREFERENCES.pvp.mobMovementEnabled,
      allowBlockBreak:
        typeof preferences.pvp?.allowBlockBreak === 'boolean'
          ? preferences.pvp.allowBlockBreak
          : DEFAULT_PLUGIN_PREFERENCES.pvp.allowBlockBreak,
    },
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    console.error('Failed to save plugin preferences', error)
  }
}
