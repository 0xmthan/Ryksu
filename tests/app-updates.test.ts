import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { IpcMain } from 'electron'
import { registerAppIpc } from '../src/main/ipc/registerAppIpc'
import { checkForUpdates } from '../src/main/services/updates'
import type { UpdateCheck } from '../src/shared/ipc'
import { fake } from './fakes'

// A stand-in for fetch that answers with `response` (only the fields checkForUpdates reads).
const respond = (response: object) => async () => fake<Response>(response)
const release = (tag: string, extra = {}) =>
  respond({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: tag, draft: false, prerelease: false, ...extra }),
  })

test('update checks compare numeric versions and accept v-prefixed tags', async () => {
  assert.deepEqual(await checkForUpdates('2.9.0', release('v2.10.0')), {
    status: 'available',
    version: '2.10.0',
  })
  assert.equal((await checkForUpdates('2.1.0', release('v2.1.0'))).status, 'current')
  assert.equal((await checkForUpdates('3.0.0', release('v2.1.0'))).status, 'current')
  assert.equal((await checkForUpdates('2.1.0-beta.1', release('v2.1.0'))).status, 'available')
})

test('missing releases are distinct from rate limits, network failures, and invalid data', async () => {
  assert.equal((await checkForUpdates('2.1.0', respond({ status: 404 }))).status, 'no-release')
  assert.equal((await checkForUpdates('2.1.0', respond({ status: 403, ok: false }))).status, 'error')
  assert.equal(
    (
      await checkForUpdates('2.1.0', async () => {
        throw new Error('offline')
      })
    ).status,
    'error'
  )
  assert.equal((await checkForUpdates('2.1.0', release('not-a-version'))).status, 'error')
  assert.equal((await checkForUpdates('2.1.0', release('v3.0.0', { prerelease: true }))).status, 'error')
  assert.equal((await checkForUpdates('2.1.0', release('v3.0.0', { draft: true }))).status, 'error')
})

test('update checks request latest GitHub release with a bounded timeout', async () => {
  await checkForUpdates('2.1.0', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/0xmthan/Ryksu/releases/latest')
    assert.equal((options?.headers as Record<string, string>).Accept, 'application/vnd.github+json')
    assert.ok(options?.signal instanceof AbortSignal)
    return fake<Response>({ status: 404 })
  })
})

type Handler = (...args: unknown[]) => unknown

// Registers the app's IPC handlers against fakes and returns them.
function mainHandlers(updateResult: UpdateCheck, openError = false) {
  const handlers = new Map<string, Handler>()
  const opened: string[] = []
  let copied = ''
  registerAppIpc({
    ipcMain: fake<IpcMain>({ handle: (name: string, handler: Handler) => handlers.set(name, handler) }),
    clipboard: {
      writeText: async (text: string) => {
        copied = text
      },
    },
    shell: {
      openExternal: async (url: string) => {
        if (openError) throw new Error('browser failed')
        opened.push(url)
      },
    },
    getAppInfo: () => ({
      version: '2.1.0',
      electron: '44.5.1',
      chromium: '148',
      node: '22',
      platform: 'darwin',
      arch: 'arm64',
    }),
    checkForUpdates: async () => updateResult,
  })
  const handler = (name: string) => {
    const found = handlers.get(name)
    assert.ok(found, `${name} is registered`)
    return found
  }
  return { handler, opened, copied: () => copied }
}

test('update IPC opens the fixed releases page only for a newer version', async () => {
  const available = mainHandlers({ status: 'available', version: '2.2.0' })
  await available.handler('app:checkForUpdates')()
  assert.deepEqual(available.opened, ['https://github.com/0xmthan/Ryksu/releases'])
  for (const status of ['current', 'no-release', 'error'] as const) {
    const other = mainHandlers({ status })
    await other.handler('app:checkForUpdates')()
    assert.deepEqual(other.opened, [])
  }
  const failed = mainHandlers({ status: 'available', version: '2.2.0' }, true)
  assert.equal(((await failed.handler('app:checkForUpdates')()) as UpdateCheck).status, 'error')
})

test('copy info IPC copies the running version and system details', () => {
  const main = mainHandlers({ status: 'current' })
  assert.equal((main.handler('app:copyInfo')() as { ok: boolean }).ok, true)
  assert.equal(
    main.copied(),
    'Ryksu 2.1.0\nPlatform: darwin / arm64\nElectron: 44.5.1\nChromium: 148\nNode.js: 22'
  )
})
