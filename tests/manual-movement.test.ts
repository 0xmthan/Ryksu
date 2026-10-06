import test from 'node:test'
import assert from 'node:assert/strict'
import { ManualMovementController } from '../src/main/bot/plugins/manualMovement'
import type { MovementControls } from '../src/shared/types'
import { asBot, fakeBot } from './fakes'

// The controller's private state, checked after a disconnect.
type Internals = { bot: unknown; timeout: unknown }

function setup() {
  const controls: Record<string, boolean> = {}
  let starts = 0
  let yaw: number | undefined
  const bot = fakeBot({
    entity: {},
    setControlState: (name: string, value: boolean) => {
      controls[name] = value
    },
    look: async (value: number) => {
      yaw = value
    },
  })
  const controller = new ManualMovementController({ onStart: () => starts++ })
  controller.attach(asBot(bot))
  return { controller, bot, controls, starts: () => starts, yaw: () => yaw }
}
const input = (changes: Partial<MovementControls> = {}): MovementControls => ({
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  sneak: false,
  yaw: 1,
  ...changes,
})

test('diagonal movement turns toward travel and updates when an individual key is released', (t) => {
  const { controller, controls, starts, yaw } = setup()
  t.after(() => controller.detach())
  assert.equal(controller.setControls(input({ forward: true, left: true })).ok, true)
  assert.deepEqual(controls, {
    forward: true,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
  })
  assert.equal(yaw(), 1 + Math.PI / 4)
  controller.setControls(input({ forward: true }))
  assert.equal(controls.left, false)
  assert.equal(controls.forward, true)
  assert.equal(starts(), 1)
  assert.equal(yaw(), 1)
  controller.setControls(input())
  assert.equal(controller.isActive(), false)
  assert.equal(controls.forward, false)
})

test('missing input heartbeat stops movement automatically', async (t) => {
  const { controller, controls } = setup()
  t.after(() => controller.detach())
  controller.setControls(input({ right: true }))
  await new Promise((resolve) => setTimeout(resolve, 650))
  assert.equal(controller.isActive(), false)
  assert.equal(controls.forward, false)
})

test('disconnect releases every held movement key', () => {
  const { controller, controls } = setup()
  controller.setControls(input({ back: true, right: true }))
  controller.detach()
  assert.deepEqual(controls, {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
  })
  const internals = controller as unknown as Internals
  assert.equal(internals.bot, null)
  assert.equal(internals.timeout, null)
})

test('malformed input and sleeping bots cannot start moving', () => {
  const { controller, bot, starts } = setup()
  assert.equal(controller.setControls({ forward: true }).ok, false)
  assert.equal(controller.setControls(input({ yaw: NaN })).ok, false)
  bot.isSleeping = true
  assert.equal(controller.setControls(input({ forward: true })).ok, false)
  assert.equal(starts(), 0)
  assert.equal(controller.isActive(), false)
  controller.detach()
})

test('release packets leave autonomous movement alone when manual control is inactive', () => {
  const { controller, controls } = setup()
  controls.forward = true
  controller.setControls(input())
  assert.equal(controls.forward, true)
  controller.detach()
})

test('each WASD direction faces its camera-relative travel heading', (t) => {
  const { controller, controls, yaw } = setup()
  t.after(() => controller.detach())
  const headings: [Partial<MovementControls>, number][] = [
    [{ forward: true }, 0],
    [{ back: true }, Math.PI],
    [{ left: true }, Math.PI / 2],
    [{ right: true }, -Math.PI / 2],
    [{ back: true, right: true }, (-3 * Math.PI) / 4],
  ]
  for (const [keys, heading] of headings) {
    controller.setControls(input({ yaw: 0, ...keys }))
    assert.equal(yaw(), heading)
    assert.deepEqual(controls, {
      forward: true,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: false,
      sneak: false,
    })
  }
})

test('opposing movement keys cancel out without rotating the bot', (t) => {
  const { controller, controls, yaw } = setup()
  t.after(() => controller.detach())
  controller.setControls(input({ forward: true }))
  controller.setControls(input({ forward: true, back: true, left: true, right: true, yaw: 2 }))
  assert.equal(controller.isActive(), false)
  assert.equal(controls.forward, false)
  assert.equal(yaw(), 1)
})

test('Space jumps in place without changing direction and releases cleanly', (t) => {
  const { controller, controls, yaw } = setup()
  t.after(() => controller.detach())
  controller.setControls(input({ jump: true }))
  assert.equal(controls.jump, true)
  assert.equal(controls.forward, false)
  assert.equal(yaw(), undefined)
  controller.setControls(input())
  assert.equal(controls.jump, false)
  assert.equal(controller.isActive(), false)
})

test('jumping while walking preserves forward movement after Space is released', (t) => {
  const { controller, controls } = setup()
  t.after(() => controller.detach())
  controller.setControls(input({ forward: true, jump: true }))
  assert.equal(controls.forward, true)
  assert.equal(controls.jump, true)
  controller.setControls(input({ forward: true }))
  assert.equal(controls.forward, true)
  assert.equal(controls.jump, false)
  assert.equal(controller.isActive(), true)
})

test('sprinting works while walking and crouching takes priority', (t) => {
  const { controller, controls } = setup()
  t.after(() => controller.detach())
  controller.setControls(input({ forward: true, sprint: true }))
  assert.equal(controls.sprint, true)
  controller.setControls(input({ forward: true, sprint: true, sneak: true }))
  assert.equal(controls.sprint, false)
  assert.equal(controls.sneak, true)
  controller.setControls(input({ forward: true, sprint: true }))
  assert.equal(controls.sprint, true)
  assert.equal(controls.sneak, false)
  controller.setControls(input())
  assert.equal(controls.sprint, false)
  assert.equal(controls.sneak, false)
})

test('crouching in place does not walk or rotate', (t) => {
  const { controller, controls, yaw } = setup()
  t.after(() => controller.detach())
  controller.setControls(input({ sneak: true }))
  assert.equal(controls.sneak, true)
  assert.equal(controls.forward, false)
  assert.equal(yaw(), undefined)
  controller.detach()
  assert.equal(controls.sneak, false)
})
