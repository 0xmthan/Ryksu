import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import type { IpcMain } from 'electron'
import type { BotManager } from '../src/main/bot/botManager'
import { fake } from './fakes'
import { loadModule } from './loadModule'

type Handler = (...args: unknown[]) => unknown

// Registers the bot's IPC handlers against a fake ipcMain and a stand-in BotManager with the given methods.
function setup(methods: object = {}) {
  const handlers = new Map<string, Handler>()
  // A fresh copy each time, since the module registers its handlers only once per process.
  const { registerBotIpc } = loadModule<typeof import('../src/main/ipc/registerBotIpc')>(
    'src/main/ipc/registerBotIpc.ts'
  )
  const manager = Object.assign(new EventEmitter(), { getSnapshot: () => null }, methods)
  registerBotIpc(
    fake<IpcMain>({ handle: (name: string, handler: Handler) => handlers.set(name, handler), on() {} }),
    fake<BotManager>(manager)
  )
  const invoke = (name: string, ...args: unknown[]) => {
    const handler = handlers.get(name)
    assert.ok(handler, `${name} is registered`)
    return handler({ sender: {} }, ...args)
  }
  return { invoke, handlers }
}

test('every bot channel the preload invokes has a handler', () => {
  const { handlers } = setup()
  const preload = readFileSync('src/preload/electronApi.ts', 'utf8')
  const channels = [...new Set([...preload.matchAll(/invoke\('(bot:\w+)'/g)].map((match) => match[1]))]
  assert.ok(channels.length > 0)
  assert.deepEqual(
    channels.filter((name) => !handlers.has(name)),
    []
  )
})

test('mining stop and block list reach the bot manager', async () => {
  const { invoke } = setup({
    stopMining: () => ({ active: false }),
    getMineableBlocks: () => [{ name: 'oak_log', displayName: 'Oak Log' }],
  })
  assert.deepEqual(await invoke('bot:stopMining'), { ok: true, state: { active: false } })
  assert.deepEqual(await invoke('bot:getMineableBlocks'), [{ name: 'oak_log', displayName: 'Oak Log' }])
})

test('actions answer ok with what they return, and turn a throw into ok: false with its message', async () => {
  const { invoke } = setup({
    useNearestBed: async () => ({ sleeping: true }),
    sendChat: async () => {
      throw new Error('Not connected.')
    },
    startMining: () => ({ active: true }),
  })
  assert.deepEqual(await invoke('bot:useBed'), { ok: true, sleeping: true })
  assert.deepEqual(await invoke('bot:sendChat', 'hi'), { ok: false, message: 'Not connected.' })
  assert.deepEqual(await invoke('bot:startMining', { ores: [], blocks: [] }), {
    ok: true,
    state: { active: true },
  })
})

test('entity and trade handlers reject malformed ids before reaching the bot', async () => {
  const called: string[] = []
  const { invoke } = setup({
    openTrader: async () => called.push('openTrader'),
    trade: async () => called.push('trade'),
    attackEntity: () => called.push('attackEntity'),
  })
  assert.deepEqual(await invoke('bot:openTrader', 'villager'), { ok: false, message: 'Invalid entity.' })
  assert.deepEqual(await invoke('bot:trade', 0, 0), { ok: false, message: 'Invalid trade.' })
  assert.deepEqual(await invoke('bot:attackEntity', 1.5), { ok: false, message: 'Invalid entity.' })
  assert.deepEqual(called, [])
})

test('skin and player name lookups only fetch Mojang URLs and UUIDs', async () => {
  const { invoke } = setup()
  assert.equal(await invoke('bot:getSkin', 'https://example.com/skin.png'), null)
  assert.equal(await invoke('bot:lookupPlayerName', '../../etc/passwd'), null)
})
