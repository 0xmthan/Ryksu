const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const { PvpController } = require('../src/bot/plugins/pvp')

function setup(options) {
  const controller = new PvpController(options)
  const bot = new EventEmitter()
  const events = []
  bot.entity = { position: new Vec3(0, 0, 0), onGround: true }
  bot.setControlState = (name, value) => events.push(`${name}:${value}`)
  bot.lookAt = async () => events.push('aim')
  bot.attack = () => events.push('attack')
  const target = { isValid: true, position: new Vec3(2, 0, 0), height: 1.8 }
  controller.bot = bot
  controller.target = target
  return { controller, bot, target, events }
}

test('jump attack waits for takeoff and sends one attack', async (t) => {
  const { controller, bot, target, events } = setup()
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
  assert.ok(controller.cooldownTicks > 0)
})

test('disabled jump attack attacks without waiting for a jump', async (t) => {
  const { controller, target, events } = setup()
  t.after(() => controller.detach())
  controller.jumpAttackEnabled = false
  await controller._attemptAttack(target)
  assert.deepEqual(events, ['aim', 'attack'])
})

test('cancelling an attack while waiting prevents a late strike', async (t) => {
  const { controller, bot, target, events } = setup()
  t.after(() => controller.detach())
  const attack = controller._attemptAttack(target)
  controller._clearTarget()
  bot.entity.onGround = false
  bot.emit('physicsTick')
  await attack
  assert.equal(events.includes('attack'), false)
  assert.equal(bot.listenerCount('physicsTick'), 0)
  assert.equal(controller.pendingAttack, null)
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
  let equipped
  const autoTool = {
    isEnabled: () => true,
    equipBestWeapon: () =>
      new Promise((resolve) => {
        equipped = resolve
      }),
  }
  const { controller, target, events } = setup({ autoTool })
  t.after(() => controller.detach())
  const attack = controller._attemptAttack(target)
  await controller._attemptAttack(target)
  controller._clearTarget()
  equipped()
  await attack
  assert.deepEqual(events, [])
})

test('blocked takeoff eventually falls back to a normal attack', async (t) => {
  const { controller, target, events } = setup()
  t.after(() => controller.detach())
  await controller._attemptAttack(target)
  assert.equal(events.filter((event) => event === 'attack').length, 1)
})
