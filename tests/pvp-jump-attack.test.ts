import test from 'node:test'
import assert from 'node:assert/strict'
import type { Entity } from 'prismarine-entity'
import { Vec3 } from 'vec3'
import type { AutoToolController } from '../src/main/bot/plugins/autoTool'
import { PvpController } from '../src/main/bot/plugins/pvp'
import { fake, fakeBot, type FakeBot } from './fakes'

// The controller's private state these tests set up and check.
type Internals = { bot: FakeBot; cooldownTicks: number; jumpAttackEnabled: boolean; pendingAttack: unknown }

function setup(options?: ConstructorParameters<typeof PvpController>[0]) {
  const controller = new PvpController(options)
  const internals = controller as unknown as Internals
  const events: string[] = []
  const bot = fakeBot({
    entity: { position: new Vec3(0, 0, 0), onGround: true },
    setControlState: (name: string, value: boolean) => events.push(`${name}:${value}`),
    lookAt: async () => events.push('aim'),
    attack: () => events.push('attack'),
  })
  const target = fake<Entity>({ isValid: true, position: new Vec3(2, 0, 0), height: 1.8 })
  internals.bot = bot
  controller.target = target
  return { controller, internals, bot, target, events }
}

test('jump attack waits for takeoff and sends one attack', async (t) => {
  const { controller, internals, bot, target, events } = setup()
  t.after(() => controller.detach())
  const attack = controller._attemptAttack(target)
  assert.deepEqual(events, ['jump:true'])
  bot.emit('physicsTick')
  await Promise.resolve()
  assert.equal(events.includes('attack'), false)
  await controller._attemptAttack(target)
  assert.equal(events.filter((event) => event === 'jump:true').length, 1)
  bot.entity.onGround = false
  bot.emit('physicsTick')
  await attack
  assert.deepEqual(events, ['jump:true', 'aim', 'attack'])
  assert.equal(bot.listenerCount('physicsTick'), 0)
  assert.ok(internals.cooldownTicks > 0)
})

test('disabled jump attack attacks without waiting for a jump', async (t) => {
  const { controller, internals, target, events } = setup()
  t.after(() => controller.detach())
  internals.jumpAttackEnabled = false
  await controller._attemptAttack(target)
  assert.deepEqual(events, ['aim', 'attack'])
})

test('cancelling an attack while waiting prevents a late strike', async (t) => {
  const { controller, internals, bot, target, events } = setup()
  t.after(() => controller.detach())
  const attack = controller._attemptAttack(target)
  controller.clearTarget()
  bot.entity.onGround = false
  bot.emit('physicsTick')
  await attack
  assert.equal(events.includes('attack'), false)
  assert.equal(bot.listenerCount('physicsTick'), 0)
  assert.equal(internals.pendingAttack, null)
  assert.ok(events.includes('jump:false'))
})

test('target moving out of reach during takeoff is not attacked', async (t) => {
  const { controller, bot, target, events } = setup()
  t.after(() => controller.detach())
  const attack = controller._attemptAttack(target)
  target.position = new Vec3(20, 0, 0)
  bot.entity.onGround = false
  bot.emit('physicsTick')
  await attack
  assert.equal(events.includes('attack'), false)
})

test('weapon equipping cannot queue duplicate or cancelled attacks', async (t) => {
  let equipped: (value: boolean) => void = () => {}
  const autoTool = fake<AutoToolController>({
    isEnabled: () => true,
    equipBestWeapon: () =>
      new Promise<boolean>((resolve) => {
        equipped = resolve
      }),
  })
  const { controller, target, events } = setup({ autoTool })
  t.after(() => controller.detach())
  const attack = controller._attemptAttack(target)
  await controller._attemptAttack(target)
  controller.clearTarget()
  equipped(true)
  await attack
  assert.deepEqual(events, [])
})

test('blocked takeoff eventually falls back to a normal attack', async (t) => {
  const { controller, target, events } = setup()
  t.after(() => controller.detach())
  await controller._attemptAttack(target)
  assert.equal(events.filter((event) => event === 'attack').length, 1)
})
