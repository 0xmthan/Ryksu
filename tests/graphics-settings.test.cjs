const { test } = require('node:test')
const assert = require('node:assert/strict')

const store = new Map()
global.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
}
const { DEFAULT_GRAPHICS, loadGraphicsSettings, saveGraphicsSettings } = require('../src/utils/graphicsSettings.ts')

test('graphics settings fall back to defaults for missing or unknown values', () => {
  assert.deepEqual(loadGraphicsSettings(), DEFAULT_GRAPHICS)
  store.set('ryksu:graphics', JSON.stringify({ resolutionScale: 3, antialiasing: 'yes', shadows: 'extreme', maxFps: 60 }))
  assert.deepEqual(loadGraphicsSettings(), { ...DEFAULT_GRAPHICS, maxFps: 60 })
  store.set('ryksu:graphics', 'not json')
  assert.deepEqual(loadGraphicsSettings(), DEFAULT_GRAPHICS)
})

test('saved graphics settings load back', () => {
  const settings = { resolutionScale: 0.5, antialiasing: false, shadows: 'off', ambientOcclusion: false, fog: false, maxFps: 30, showFps: false }
  saveGraphicsSettings(settings)
  assert.deepEqual(JSON.parse(store.get('ryksu:graphics')), settings)
  assert.deepEqual(loadGraphicsSettings(), settings)
})

test('quality presets are recognized, and a changed option makes the settings custom', () => {
  const { QUALITY_PRESETS, presetOf } = require('../src/utils/graphicsSettings.ts')
  assert.equal(presetOf(DEFAULT_GRAPHICS), 'high')
  for (const preset of Object.keys(QUALITY_PRESETS)) {
    assert.equal(presetOf({ ...DEFAULT_GRAPHICS, ...QUALITY_PRESETS[preset], maxFps: 30 }), preset)
  }
  assert.equal(presetOf({ ...DEFAULT_GRAPHICS, fog: false }), null)
})
