import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import type { BotManager } from '../src/main/bot/botManager'
import { fake } from './fakes'
import { loadModule } from './loadModule'

// Its own port, so it can't clash with a running app.
process.env.RYKSU_CONTROL_PORT = '47699'
const { createControlApi } = loadModule<typeof import('../src/main/controlApi')>('src/main/controlApi.ts')

const manager = () =>
  fake<BotManager>(Object.assign(new EventEmitter(), { bot: null, getSnapshot: () => null }))

const get = (path: string) =>
  fetch(`http://127.0.0.1:47699${path}`).then(async (response) => ({
    status: response.status,
    body: await response.json(),
  }))

test('turning the control API on serves requests, and off closes it', async () => {
  const api = createControlApi(manager(), () => null)
  assert.deepEqual(api.status(), { enabled: false, port: 47699, error: null })

  assert.equal((await api.start()).enabled, true)
  assert.deepEqual(await get('/state'), { status: 200, body: { connected: false, inWorld: false } })
  assert.equal((await get('/nope')).status, 404)

  assert.equal((await api.stop()).enabled, false)
  await assert.rejects(get('/state'))
})

test('a taken port is reported instead of crashing', async (t) => {
  const blocker = http.createServer()
  await new Promise<void>((resolve) => blocker.listen(47699, '127.0.0.1', resolve))
  t.after(() => blocker.close())
  const api = createControlApi(manager(), () => null)
  assert.deepEqual(await api.start(), { enabled: false, port: 47699, error: 'Port 47699 is already in use.' })
})
