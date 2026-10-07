import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import { AutomationGate } from '../src/main/bot/automation'
import { createScriptApi, Session, type ScriptTarget } from '../src/main/scripts/scriptApi'
import { ScriptHost } from '../src/main/scripts/scriptHost'
import { WHEAT_FARM_SCRIPT } from '../src/main/scripts/scriptStore'
import type { ScriptWorld } from '../src/main/scripts/scriptWorld'
import { SCRIPT_CALLS } from '../src/shared/scriptApi'
import type { Script } from '../src/shared/types'
import { asBot, fake, fakeBot } from './fakes'

// A host with one script, a bot standing at the origin, and a record of what the script did. `world` stands
// in for the block and inventory calls.
const setup = (code: string, world: Partial<ScriptWorld> = {}) => {
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
      notify: (_title, text) => events.push(`notify: ${text}`),
      world: fake<ScriptTarget['world']>(world),
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
  assert.deepEqual(host.getState().running, {
    id: 'one',
    status: 'AFK at the iron farm',
    worldHidden: false,
    toggles: {},
  })

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
  const stopped = host.stop()
  await settle()
  teleport(50, 50)
  await stopped
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

test("the editor's API list names every call scripts have, and nothing else", () => {
  const session = new Session()
  const api = createScriptApi(
    fake<ScriptTarget>({}),
    { current: () => session, run: (_session, action) => action() },
    { log: () => {}, status: () => {}, hideWorld: () => {}, notify: () => {}, exit: () => {} }
  )
  assert.deepEqual(SCRIPT_CALLS.map((call) => call.name).sort(), Object.keys(api).sort())
})

test('a script can hide the world, and it comes back when the script turns off', async () => {
  const { host } = setup('async function start() { ryksu.hideWorld() }')
  await host.start('one')
  await settle()
  assert.equal(host.getState().running?.worldHidden, true)
  await host.stop()
  assert.equal(host.getState().running, null)
})

test("start() code that carries on after a turn-off can't act through stop()", async () => {
  const { host, said, teleport } = setup(`
    async function start() {
      try {
        await ryksu.wait(60000)
      } catch {
        ryksu.chat('still farming')
      }
    }
    async function stop() {
      ryksu.chat('/wp home')
      await ryksu.waitForTeleport()
    }
  `)
  await host.start('one')
  const stopped = host.stop()
  await settle()
  teleport(50, 50)
  await stopped
  assert.deepEqual(said, ['/wp home'])
})

test('a script can turn itself off, and its stop() runs', async () => {
  const { host, said } = setup(`
    async function start() {
      ryksu.exit('Nothing to do.')
      ryksu.chat('not this')
    }
    async function stop() { ryksu.chat('bye') }
  `)
  await host.start('one')
  await settle()
  await settle()
  assert.equal(host.getState().running, null)
  assert.deepEqual(said, ['bye'])
  assert.ok(host.getState().log.some((entry) => entry.text === 'One: Nothing to do.'))
})

const wheatFarm = (chest: string) =>
  WHEAT_FARM_SCRIPT.code.replace('const CHEST = null', `const CHEST = ${chest}`)

test("the wheat farm doesn't go with a full inventory", async () => {
  const { host, said } = setup(wheatFarm('null'), { freeSlots: () => 0 })
  await host.start('one')
  await settle()
  await settle()
  assert.equal(host.getState().running, null)
  assert.deepEqual(said, [])
  assert.match(
    host
      .getState()
      .log.map((entry) => entry.text)
      .join('\n'),
    /inventory is full/
  )
})

test('the wheat farm goes home when the chest is missing', async () => {
  const { host, said, teleport } = setup(wheatFarm('{ x: 5, y: 64, z: 5 }'), {
    freeSlots: () => 10,
    blockAt: () => ({ x: 5, y: 64, z: 5, name: 'air', properties: {} }),
  })
  await host.start('one')
  teleport(100, 100)
  await settle()
  await settle()
  assert.deepEqual(said, ['/wp wheat_farm', '/wp home'])
  teleport(0, 0)
  await settle()
  assert.equal(host.getState().running, null)
  assert.match(
    host
      .getState()
      .log.map((entry) => entry.text)
      .join('\n'),
    /no chest at 5 64 5/
  )
})

test('row order crosses a field once, every other row backwards', async () => {
  const { rowOrder } = await import('../src/main/scripts/scriptWorld')
  const field = [0, 1].flatMap((z) => [0, 1, 2].map((x) => new Vec3(x, 64, z)))
  assert.deepEqual(
    rowOrder(field).map(({ x, z }) => `${x},${z}`),
    ['0,0', '1,0', '2,0', '2,1', '1,1', '0,1']
  )
})

// A farm with two ripe wheat and a chest at 5 64 5. `chestRoom`: how many items the chest still takes.
const farmWorld = (chestRoom: number) => {
  let carried = [{ name: 'wheat_seeds', count: 10 }]
  const calls: string[] = []
  const world: Partial<ScriptWorld> = {
    freeSlots: () => 10,
    blockAt: ({ x, y, z }) => ({ x, y, z, name: x === 5 && z === 5 ? 'chest' : 'air', properties: {} }),
    findBlocks: (name) => [{ x: 1, y: 63, z: 1, name, properties: {} }],
    digAll: async () => {
      calls.push('digAll')
      carried = [...carried, { name: 'wheat', count: 2 }]
      return { dug: 2, skipped: 0 }
    },
    collectDrops: async () => 0,
    useItemOnAll: async () => {
      calls.push('plant')
      return { used: 1, skipped: 0 }
    },
    inventory: () => carried,
    withdraw: async () => 0,
    deposit: async () => {
      calls.push('deposit')
      const stored = carried.reduce((sum, item) => sum + item.count, 0)
      if (stored > chestRoom) return 0
      carried = []
      return stored
    },
  }
  return { world, calls }
}

test('the wheat farm harvests, plants, stores and goes home in one trip', async () => {
  const { world, calls } = farmWorld(100)
  const { host, said, teleport } = setup(wheatFarm('{ x: 5, y: 64, z: 5 }'), world)
  await host.start('one')
  teleport(100, 100)
  for (let i = 0; i < 5; i++) await settle()
  assert.deepEqual(calls, ['digAll', 'plant', 'deposit'])
  assert.deepEqual(said, ['/wp wheat_farm', '/wp home'])
  teleport(0, 0)
  await settle()
  assert.equal(host.getState().running, null)
})

test('the wheat farm says so and goes home when the chest is full', async () => {
  const { world } = farmWorld(0)
  const { host, said, events, teleport } = setup(wheatFarm('{ x: 5, y: 64, z: 5 }'), world)
  await host.start('one')
  teleport(100, 100)
  for (let i = 0; i < 5; i++) await settle()
  assert.ok(events.includes('notify: The chest is full. Going home.'))
  assert.deepEqual(said, ['/wp wheat_farm', '/wp home'])
  teleport(0, 0)
  await settle()
})
