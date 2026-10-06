// Graphics options for the 3D view, saved in this app and read each time the view opens.
const STORAGE_KEY = 'ryksu:graphics'

export type ShadowQuality = 'off' | 'low' | 'high' | 'ultra'
export type WaterQuality = 'simple' | 'fancy' | 'realistic'

export type GraphicsSettings = {
  // Fraction of the screen's pixel density the view renders at.
  resolutionScale: number
  antialiasing: boolean
  shadows: ShadowQuality
  // Darker corners where blocks meet, like the game's smooth lighting.
  ambientOcclusion: boolean
  // The world fades into the sky toward the edge of the view.
  fog: boolean
  // How water is shaded (src/renderer/features/watcher/scene/water.ts).
  water: WaterQuality
  // Blocks out from the bot the 3D view shows. Left alone by the presets.
  renderDistance: number
  // Experimental: torch light cast as rays through the blocks, so blocks throw shadows (watcher/torchRays.ts).
  // Off by default and left alone by the presets.
  torchRays: boolean
  // Frames per second; 0 is the screen's refresh rate, UNLIMITED_FPS draws as fast as it can (from the
  // next launch, since Chromium's frame cap is set when the app starts).
  maxFps: number
  // The frame rate in the title bar while connected.
  showFps: boolean
}

export const RESOLUTION_SCALES = [0.5, 0.75, 1] as const
export const RENDER_DISTANCES = [32, 52, 80, 112] as const
export const SHADOW_QUALITIES: ShadowQuality[] = ['off', 'low', 'high', 'ultra']
export const WATER_QUALITIES: WaterQuality[] = ['simple', 'fancy', 'realistic']
export const UNLIMITED_FPS = -1
export const FPS_LIMITS = [30, 60, 0, UNLIMITED_FPS] as const
export const SHADOW_MAP_SIZE: Record<Exclude<ShadowQuality, 'off'>, number> = {
  low: 1024,
  high: 2048,
  ultra: 4096,
}

// The look settings each quality preset sets; the frame rate options are left as they are.
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra'
type LookSettings = Pick<
  GraphicsSettings,
  'resolutionScale' | 'antialiasing' | 'shadows' | 'ambientOcclusion' | 'fog' | 'water'
>
export const QUALITY_PRESETS: Record<QualityPreset, LookSettings> = {
  low: {
    resolutionScale: 0.5,
    antialiasing: false,
    shadows: 'off',
    ambientOcclusion: false,
    fog: false,
    water: 'simple',
  },
  medium: {
    resolutionScale: 0.75,
    antialiasing: true,
    shadows: 'low',
    ambientOcclusion: true,
    fog: true,
    water: 'fancy',
  },
  high: {
    resolutionScale: 1,
    antialiasing: true,
    shadows: 'high',
    ambientOcclusion: true,
    fog: true,
    water: 'realistic',
  },
  ultra: {
    resolutionScale: 1,
    antialiasing: true,
    shadows: 'ultra',
    ambientOcclusion: true,
    fog: true,
    water: 'realistic',
  },
}

// The preset the settings match, or null when they've been changed from all of them.
export const presetOf = (settings: GraphicsSettings): QualityPreset | null =>
  (Object.keys(QUALITY_PRESETS) as QualityPreset[]).find((preset) =>
    (Object.entries(QUALITY_PRESETS[preset]) as [keyof LookSettings, unknown][]).every(
      ([key, value]) => settings[key] === value
    )
  ) ?? null

export const DEFAULT_GRAPHICS: GraphicsSettings = {
  ...QUALITY_PRESETS.high,
  renderDistance: 52,
  torchRays: false,
  maxFps: 0,
  showFps: true,
}

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T) =>
  allowed.includes(value as T) ? (value as T) : fallback

// The latest choice, so it still applies this session if storage is unavailable.
let current: GraphicsSettings | null = null
const listeners = new Set<(settings: GraphicsSettings) => void>()

// Called with each change, so an open 3D view can apply it straight away.
export const onGraphicsSettingsChange = (listener: (settings: GraphicsSettings) => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const loadGraphicsSettings = (): GraphicsSettings => {
  if (current) return { ...current }
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {}
    return {
      resolutionScale: pick(stored.resolutionScale, RESOLUTION_SCALES, DEFAULT_GRAPHICS.resolutionScale),
      antialiasing:
        typeof stored.antialiasing === 'boolean' ? stored.antialiasing : DEFAULT_GRAPHICS.antialiasing,
      shadows: pick(stored.shadows, SHADOW_QUALITIES, DEFAULT_GRAPHICS.shadows),
      ambientOcclusion:
        typeof stored.ambientOcclusion === 'boolean'
          ? stored.ambientOcclusion
          : DEFAULT_GRAPHICS.ambientOcclusion,
      fog: typeof stored.fog === 'boolean' ? stored.fog : DEFAULT_GRAPHICS.fog,
      water: pick(stored.water, WATER_QUALITIES, DEFAULT_GRAPHICS.water),
      renderDistance: pick(stored.renderDistance, RENDER_DISTANCES, DEFAULT_GRAPHICS.renderDistance),
      torchRays: typeof stored.torchRays === 'boolean' ? stored.torchRays : DEFAULT_GRAPHICS.torchRays,
      maxFps: pick(stored.maxFps, FPS_LIMITS, DEFAULT_GRAPHICS.maxFps),
      showFps: typeof stored.showFps === 'boolean' ? stored.showFps : DEFAULT_GRAPHICS.showFps,
    }
  } catch {
    return { ...DEFAULT_GRAPHICS }
  }
}

export const saveGraphicsSettings = (settings: GraphicsSettings) => {
  current = { ...settings }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable; the choice lasts until the app closes.
  }
  for (const listener of listeners) listener({ ...settings })
}
