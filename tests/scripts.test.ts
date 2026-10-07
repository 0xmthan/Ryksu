import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import { AutomationGate } from '../src/main/bot/automation'
import { ScriptHost } from '../src/main/scripts/scriptHost'
import type { Script } from '../src/shared/types'
import { asBot, fakeBot } from './fakes'

// A host with one script, a bot standing at the origin, and a record of what the script did.
const setup = (code: string) => {
  const bot = fakeBot({ entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20 })
  const said: string[] = []
  const events: string[] = []
  const saved: Script[][] = []
  const host = new ScriptHost({
    store: { load: () => [{ id: 'one', name: 'One', code }], save: (scripts) => saved.push(scripts) },
    target: {
      getBot: () => asBot(bot),
      chat: (text) => said.push(text),
      goto: async () => {},
      stopMoving: () => events.push('stopMoving'),
      toggles: () => ({}) as never,
      setToggle: (feature, on) => events.push(`${feature}=${on}`),
      pauseAutomation: () => events.push('pause'),
      resumeAutomation: () => events.push('resume'),
    },
  })
  // The server teleporting the bot.
  const teleport = (x: number, z: number) => {
    bot.entity.position = new Vec3(x, 64, z)
    bot.emit('forcedMove')
  }
  return { bot, host, said, events, saved, teleport }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

const IRON_FARM = `
async function start() {
  ryksu.chat('/wp iron_farm')
  await ryksu.waitForTeleport()
  ryksu.status('AFK at the iron farm')
}
async function stop() {
  ryksu.chat('/wp home')
  await ryksu.waitForTeleport()
}
`

test('turning a script on pauses the automatic features, and off runs its stop() and restores them', async () => {
  const { host, said, events, teleport } = setup(IRON_FARM)
  await host.start('one')
  assert.deepEqual(events, ['pause'])
  assert.deepEqual(said, ['/wp iron_farm'])

  teleport(300, 300)
  await settle()
  assert.deepEqual(host.getState().running, { id: 'one', status: 'AFK at the iron farm' })

  const stopped = host.stop()
  await settle()
  assert.deepEqual(said, ['/wp iron_farm', '/wp home'])
  assert.equal(host.getState().running?.status, 'Stopping…')
  teleport(0, 0)
  await stopped
  assert.equal(host.getState().running, null)
  assert.deepEqual(events, ['pause', 'resume'])
})

test('a small server correction is not a teleport', async () => {
  const { host, teleport } = setup(IRON_FARM)
  await host.start('one')
  teleport(0.5, 0)
  await settle()
  assert.equal(host.getState().running?.status, 'Starting…')
  await host.stop()
})

test('turning a script off mid-wait stops start() there', async () => {
  const { host, said } = setup(`
    async function start() {
      await ryksu.wait(60000)
      ryksu.chat('too late')
    }
  `)
  await host.start('one')
  await host.stop()
  await settle()
  assert.deepEqual(said, [])
  assert.equal(host.getState().running, null)
})

test('a script that fails to load changes nothing and says why', async () => {
  const { host, events } = setup('async function start( {')
  await assert.rejects(host.start('one'), /didn't load/)
  assert.deepEqual(events, [])
  assert.equal(host.getState().log.at(-1)?.level, 'error')
})

test('an error in start() turns the script off without running stop()', async () => {
  const { host, said, events } = setup(`
    async function start() { throw new Error('no farm') }
    async function stop() { ryksu.chat('/wp home') }
  `)
  await host.start('one')
  await settle()
  assert.equal(host.getState().running, null)
  assert.deepEqual(events, ['pause', 'resume'])
  assert.deepEqual(said, [])
  assert.match(host.getState().log.at(-1)?.text ?? '', /no farm/)
})

test('scripts can turn automatic features back on, but only known ones', async () => {
  const { host, events } = setup(`
    async function start() {
      ryksu.setToggle('autoEat', true)
      ryksu.setToggle('flying', true)
    }
  `)
  await host.start('one')
  await settle()
  assert.deepEqual(events, ['pause', 'autoEat=true', 'resume'])
  assert.match(host.getState().log.at(-1)?.text ?? '', /Unknown toggle "flying"/)
})

test('the gate uses the user picks unless a script is running', () => {
  const gate = new AutomationGate()
  assert.equal(gate.resolve('autoEat', true), true)
  gate.pause()
  assert.equal(gate.resolve('autoEat', true), false)
  gate.set('autoEat', true)
  assert.equal(gate.resolve('autoEat', false), true)
  gate.resume()
  assert.equal(gate.resolve('autoEat', false), false)
})
