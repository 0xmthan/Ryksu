import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_GRAPHICS,
  loadGraphicsSettings,
  presetOf,
  QUALITY_PRESETS,
  saveGraphicsSettings,
  type GraphicsSettings,
} from '../src/utils/graphicsSettings'

// The settings are read from localStorage when loaded, so a stand-in installed here is in place in time.
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
} as Storage

test('graphics settings fall back to defaults for missing or unknown values', () => {
  assert.deepEqual(loadGraphicsSettings(), DEFAULT_GRAPHICS)
  store.set('ryksu:graphics', JSON.stringify({ resolutionScale: 3, antialiasing: 'yes', shadows: 'extreme', maxFps: 60 }))
  assert.deepEqual(loadGraphicsSettings(), { ...DEFAULT_GRAPHICS, maxFps: 60 })
  store.set('ryksu:graphics', 'not json')
  assert.deepEqual(loadGraphicsSettings(), DEFAULT_GRAPHICS)
})

test('saved graphics settings load back', () => {
  const settings: GraphicsSettings = {
    resolutionScale: 0.5,
    antialiasing: false,
    shadows: 'off',
    ambientOcclusion: false,
    fog: false,
    water: 'simple',
    renderDistance: 32,
    torchRays: false,
    maxFps: 30,
    showFps: false,
  }
  saveGraphicsSettings(settings)
  assert.deepEqual(JSON.parse(store.get('ryksu:graphics') ?? 'null'), settings)
  assert.deepEqual(loadGraphicsSettings(), settings)
})

test('quality presets are recognized, and a changed option makes the settings custom', () => {
  assert.equal(presetOf(DEFAULT_GRAPHICS), 'high')
  for (const preset of Object.keys(QUALITY_PRESETS) as (keyof typeof QUALITY_PRESETS)[]) {
    assert.equal(presetOf({ ...DEFAULT_GRAPHICS, ...QUALITY_PRESETS[preset], maxFps: 30 }), preset)
  }
  assert.equal(presetOf({ ...DEFAULT_GRAPHICS, fog: false }), null)
})
