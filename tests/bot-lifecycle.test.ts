import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { BotStatusPayload } from '../src/shared/types'
import { fakeBot, type FakeBot } from './fakes'
import { loadModule } from './loadModule'

// A bot that never reaches a server: mineflayer's createBot hands out this instead, and each test drives it by
// emitting the events a real connection would.
const newBot = () => {
  const bot = fakeBot({
    _client: Object.assign(new EventEmitter(), { write() {} }),
    entity: null,
    entities: {},
    players: {},
    inventory: { slots: [], items: () => [] },
    registry: { blocksByName: {}, itemsByName: {}, entitiesByName: {} },
    loadPlugin: (plugin: (bot: FakeBot) => void) => plugin(bot),
    hasPlugin: () => false,
    getControlState: () => false,
    setControlState() {},
    clearControlStates() {},
    quitReason: null,
  })
  bot.quit = (reason: string) => {
    bot.quitReason = reason
  }
  return bot
}

function setup() {
  const bots: FakeBot[] = []
  const { BotManager } = loadModule<typeof import('../src/main/bot/botManager')>(
    'src/main/bot/botManager.ts',
    {
      mineflayer: {
        createBot: () => {
          const bot = newBot()
          bots.push(bot)
          return bot
        },
      },
    }
  )
  const manager = new BotManager()
  const statuses: BotStatusPayload[] = []
  manager.on('status', (status) => statuses.push(status))
  const stages = () => statuses.map((status) => status.stage)
  return { manager, bots, stages, statuses }
}

// connect() first awaits the previous disconnect, so the bot exists a tick later.
const nextTick = () => new Promise((resolve) => setImmediate(resolve))

const options = { host: 'localhost', port: '25565', username: 'Steve', accountType: 'offline' as const }

test('connecting resolves once the bot logs in, and disconnecting quits and detaches it', async (t) => {
  const { manager, bots, stages } = setup()
  t.after(() => manager.disconnect())
  const connected = manager.connect(options)
  await nextTick()
  const [bot] = bots
  bot.emit('login')
  await connected

  assert.deepEqual(stages(), ['connecting', 'connected'])
  assert.equal(manager.bot, bot)

  await manager.disconnect()
  assert.equal(bot.quitReason, 'User requested disconnect')
  assert.equal(manager.bot, null)
  assert.equal(stages().at(-1), 'disconnected')
  // Every plugin let go of the bot.
  assert.deepEqual(bot.eventNames(), [])
})

test('a kick before login rejects the connect with the reason', async () => {
  const { manager, bots, stages } = setup()
  const connected = manager.connect(options)
  await nextTick()
  bots[0].emit('kicked', 'Server is full', false)

  await assert.rejects(connected, { message: 'Kicked: Server is full' })
  assert.deepEqual(stages(), ['connecting', 'kicked'])
})

test('the connection ending before login rejects, and after login just reports the disconnect', async () => {
  const early = setup()
  const failed = early.manager.connect(options)
  await nextTick()
  early.bots[0].emit('end')
  await assert.rejects(failed, { message: 'Connection ended before login.' })

  const late = setup()
  const connected = late.manager.connect(options)
  await nextTick()
  const [bot] = late.bots
  bot.emit('login')
  await connected
  bot.emit('end')
  assert.equal(late.stages().at(-1), 'disconnected')
  assert.equal(late.manager.bot, null)
  assert.equal(late.manager.getSnapshot(), null)
})

test('a plugin packet the client cannot parse only warns once after login', async (t) => {
  const { manager, bots, stages } = setup()
  t.after(() => manager.disconnect())
  const connected = manager.connect(options)
  await nextTick()
  const [bot] = bots
  bot.emit('login')
  await connected

  const error = new Error('Chunk size is 12 but only 8 was read ; partial packet : {"name":"player_info"}')
  bot.emit('error', error)
  bot.emit('error', error)

  assert.deepEqual(stages(), ['connecting', 'connected', 'warning'])
  assert.equal(manager.bot, bot)
})

test('connecting again replaces the previous bot', async (t) => {
  const { manager, bots } = setup()
  t.after(() => manager.disconnect())
  const first = manager.connect(options)
  await nextTick()
  bots[0].emit('login')
  await first

  const second = manager.connect(options)
  await nextTick()
  bots[1].emit('login')
  await second

  assert.equal(bots[0].quitReason, 'User requested disconnect')
  assert.equal(manager.bot, bots[1])
})
