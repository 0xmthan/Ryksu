import test from 'node:test'
import assert from 'node:assert/strict'
import { AutoShieldController } from '../src/main/bot/plugins/autoShield'
import { fakeBot } from './fakes'

// The controller's private state these tests drive directly.
type Internals = {
  bot: ReturnType<typeof fakeBot>
  desiredBlocking: boolean
  raised: boolean
  _applyShieldState: () => void
}

test('with no threat around, the shield logic leaves eating alone', () => {
  const shield = new AutoShieldController()
  const internals = shield as unknown as Internals
  let deactivated = 0
  internals.bot = fakeBot({ usingHeldItem: true, deactivateItem: () => deactivated++ })
  internals.desiredBlocking = false
  // Every tick, as the plugin does.
  for (let tick = 0; tick < 5; tick++) internals._applyShieldState()
  assert.equal(deactivated, 0)
})

test('a shield it raised is lowered once the threat is gone', () => {
  const shield = new AutoShieldController()
  const internals = shield as unknown as Internals
  let deactivated = 0
  internals.bot = fakeBot({ usingHeldItem: true, deactivateItem: () => deactivated++ })
  internals.raised = true
  internals.desiredBlocking = false
  internals._applyShieldState()
  internals._applyShieldState()
  assert.equal(deactivated, 1)
})
