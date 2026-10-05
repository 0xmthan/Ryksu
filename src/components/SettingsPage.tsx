import { type ReactNode, useEffect, useState } from 'react'
import { Monitor, RotateCcw, X } from 'lucide-react'
import {
  DEFAULT_GRAPHICS,
  FPS_LIMITS,
  QUALITY_PRESETS,
  RESOLUTION_SCALES,
  SHADOW_QUALITIES,
  UNLIMITED_FPS,
  WATER_QUALITIES,
  loadGraphicsSettings,
  presetOf,
  saveGraphicsSettings,
  type GraphicsSettings,
  type QualityPreset,
  type ShadowQuality,
  type WaterQuality,
} from '../utils/graphicsSettings'

const SHADOW_LABELS: Record<ShadowQuality, string> = { off: 'Off', low: 'Low', high: 'High', ultra: 'Ultra' }
const WATER_LABELS: Record<WaterQuality, string> = { simple: 'Simple', fancy: 'Fancy', realistic: 'Realistic' }
const WATER_HINTS: Record<WaterQuality, string> = {
  simple: "The game's water texture, see-through.",
  fancy: 'Ripples run across the surface and catch the light.',
  realistic: 'Ripples that reflect the sky, glint in the sun and moon, and turn clear when you look straight down.',
}
const PRESET_LABELS: Record<QualityPreset, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' }
const PRESET_HINTS: Record<QualityPreset, string> = {
  low: 'Fastest: lower resolution, no shadows or effects.',
  medium: 'Balanced: softer shadows, rippling water and a slightly lower resolution.',
  high: 'Shadows, shaded corners, fog and realistic water at full resolution.',
  ultra: 'Everything on, with the sharpest shadows. Needs a strong GPU.',
}

type Option<T> = { value: T; label: string }

function Segmented<T extends string | number | boolean>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Option<T>[]
  // null selects none (e.g. settings that match no preset).
  value: T | null
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-lg border border-neutral-800 bg-neutral-900 p-0.5">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition focus-visible:outline
              focus-visible:outline-sky-400 ${
                selected ? 'bg-sky-500/20 text-sky-100' : 'text-neutral-400 hover:text-neutral-200'
              }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function Row({ title, hint, children }: { title: ReactNode; hint: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm text-neutral-200">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-neutral-500">{hint}</div>
      </div>
      {children}
    </div>
  )
}

// While connected, the page opens over the game (blurred behind it) instead of replacing it.
export default function SettingsPage({ onClose }: { onClose?: () => void }) {
  const [graphics, setGraphics] = useState<GraphicsSettings>(loadGraphicsSettings)

  // Whether this launch has the frame cap off; null until known.
  const [launchedUnlimited, setLaunchedUnlimited] = useState<boolean | null>(null)
  useEffect(() => {
    window.electronAPI.getUnlimitedFps().then(setLaunchedUnlimited, () => setLaunchedUnlimited(false))
  }, [])

  const update = (changes: Partial<GraphicsSettings>) => {
    const next = { ...graphics, ...changes }
    setGraphics(next)
    saveGraphicsSettings(next)
    if (next.maxFps !== graphics.maxFps) void window.electronAPI.setUnlimitedFps(next.maxFps === UNLIMITED_FPS)
  }

  // 30 and 60 apply straight away either way; Unlimited and Max only once the cap matches at launch.
  const needsRestart =
    launchedUnlimited !== null &&
    (graphics.maxFps === UNLIMITED_FPS ? !launchedUnlimited : graphics.maxFps === 0 && launchedUnlimited)

  useEffect(() => {
    if (!onClose) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const preset = presetOf(graphics)

  const isDefault = (Object.keys(DEFAULT_GRAPHICS) as (keyof GraphicsSettings)[]).every(
    (key) => graphics[key] === DEFAULT_GRAPHICS[key]
  )

  const page = (
    <section className="mx-auto w-full max-w-xl px-6 py-8 text-neutral-200" aria-labelledby="settings-heading">
      <div className="flex items-center justify-between gap-4">
        <h1 id="settings-heading" className="text-2xl font-bold uppercase tracking-tight text-neutral-100">
          Settings
        </h1>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-700/60
              bg-neutral-900/70 text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100
              focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      <section
        className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950/70 px-6 pt-5 pb-2"
        aria-labelledby="graphics-heading"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="graphics-heading" className="flex items-center gap-2 text-sm font-medium text-neutral-300">
            <Monitor size={15} aria-hidden="true" className="text-neutral-500" />
            Graphics
          </h2>
          <button
            type="button"
            onClick={() => update(DEFAULT_GRAPHICS)}
            disabled={isDefault}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-500 transition
              hover:bg-neutral-800 hover:text-sky-200 focus-visible:outline-sky-400 disabled:pointer-events-none
              disabled:opacity-0"
          >
            <RotateCcw size={12} aria-hidden="true" />
            Reset
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">For the 3D view.</p>
        <div className="mt-2 divide-y divide-neutral-800/80">
          <Row
            title="Quality"
            hint={preset ? PRESET_HINTS[preset] : 'Custom: your own mix of the options below.'}
          >
            <Segmented
              label="Quality"
              options={(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((value) => ({
                value,
                label: PRESET_LABELS[value],
              }))}
              value={preset}
              onChange={(next) => update(QUALITY_PRESETS[next])}
            />
          </Row>
          <Row title="Resolution" hint="Lower renders fewer pixels, for a smoother view on slower machines.">
            <Segmented
              label="Resolution"
              options={RESOLUTION_SCALES.map((value) => ({ value, label: `${value * 100}%` }))}
              value={graphics.resolutionScale}
              onChange={(resolutionScale) => update({ resolutionScale })}
            />
          </Row>
          <Row title="Antialiasing" hint="Smooths the jagged edges of blocks. Applies the next time you connect.">
            <Segmented
              label="Antialiasing"
              options={[
                { value: false, label: 'Off' },
                { value: true, label: 'On' },
              ]}
              value={graphics.antialiasing}
              onChange={(antialiasing) => update({ antialiasing })}
            />
          </Row>
          <Row title="Shadows" hint="Shadows from the sun and moon. Higher is sharper but slower.">
            <Segmented
              label="Shadows"
              options={SHADOW_QUALITIES.map((value) => ({ value, label: SHADOW_LABELS[value] }))}
              value={graphics.shadows}
              onChange={(shadows) => update({ shadows })}
            />
          </Row>
          <Row title="Ambient occlusion" hint="Shades the corners where blocks meet, for more depth.">
            <Segmented
              label="Ambient occlusion"
              options={[
                { value: false, label: 'Off' },
                { value: true, label: 'On' },
              ]}
              value={graphics.ambientOcclusion}
              onChange={(ambientOcclusion) => update({ ambientOcclusion })}
            />
          </Row>
          <Row title="Fog" hint="Fades the world into the sky toward the edge of the view.">
            <Segmented
              label="Fog"
              options={[
                { value: false, label: 'Off' },
                { value: true, label: 'On' },
              ]}
              value={graphics.fog}
              onChange={(fog) => update({ fog })}
            />
          </Row>
          <Row title="Water" hint={WATER_HINTS[graphics.water]}>
            <Segmented
              label="Water"
              options={WATER_QUALITIES.map((value) => ({ value, label: WATER_LABELS[value] }))}
              value={graphics.water}
              onChange={(water) => update({ water })}
            />
          </Row>
          <Row
            title={
              <>
                Ray-traced torches
                <span className="rounded border border-amber-400/40 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-300">
                  Experimental
                </span>
              </>
            }
            hint="Torch and lantern light is cast as rays, so blocks, mobs and players throw real shadows. Heavy near many lights."
          >
            <Segmented
              label="Ray-traced torches"
              options={[
                { value: false, label: 'Off' },
                { value: true, label: 'On' },
              ]}
              value={graphics.torchRays}
              onChange={(torchRays) => update({ torchRays })}
            />
          </Row>
          <Row
            title="Frame rate limit"
            hint={
              needsRestart ? (
                <span className="text-amber-300">Restart Ryksu to apply.</span>
              ) : graphics.maxFps === UNLIMITED_FPS ? (
                'Draws as fast as it can, past the screen. Runs warmer, uses more battery, and may tear.'
              ) : (
                "Max matches your screen's refresh rate (60 on most displays). A lower limit saves power."
              )
            }
          >
            <Segmented
              label="Frame rate limit"
              options={FPS_LIMITS.map((value) => ({
                value,
                label: value === UNLIMITED_FPS ? 'Unlimited' : value ? `${value}` : 'Max',
              }))}
              value={graphics.maxFps}
              onChange={(maxFps) => update({ maxFps })}
            />
          </Row>
          <Row title="Show FPS" hint="The frame rate in the title bar while connected.">
            <Segmented
              label="Show FPS"
              options={[
                { value: false, label: 'Off' },
                { value: true, label: 'On' },
              ]}
              value={graphics.showFps}
              onChange={(showFps) => update({ showFps })}
            />
          </Row>
        </div>
      </section>
    </section>
  )

  if (!onClose) return page
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-heading"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-x-0 top-12 bottom-0 z-40 overflow-y-auto bg-neutral-950/40 backdrop-blur-md"
    >
      {page}
    </div>
  )
}
