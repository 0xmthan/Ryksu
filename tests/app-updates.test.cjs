const { test } = require('node:test')
const assert = require('node:assert/strict')
const { checkForUpdates } = require('../src/appUpdates')

const release =
  (tag, extra = {}) =>
  async () => ({
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
  assert.equal((await checkForUpdates('2.1.0', async () => ({ status: 404 }))).status, 'no-release')
  assert.equal((await checkForUpdates('2.1.0', async () => ({ status: 403, ok: false }))).status, 'error')
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
    assert.equal(options.headers.Accept, 'application/vnd.github+json')
    assert.ok(options.signal instanceof AbortSignal)
    return { status: 404 }
  })
})

function mainHandlers(updateResult, openError = false) {
  const fs = require('node:fs')
  const vm = require('node:vm')
  const handlers = new Map()
  const opened = []
  let copied = ''
  const electron = {
    app: {
      getVersion: () => '2.1.0',
      // No display.json there, so the frame cap stays on.
      getPath: () => require('node:os').tmpdir() + '/ryksu-test-missing',
      commandLine: { appendSwitch() {} },
      whenReady: () => ({ then() {} }),
      on() {},
    },
    BrowserWindow: {},
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
    clipboard: {
      writeText: (text) => {
        copied = text
      },
    },
    shell: {
      openExternal: async (url) => {
        if (openError) throw new Error('browser failed')
        opened.push(url)
      },
    },
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/main'), 'utf8'), {
    require: (name) => {
      if (name === 'electron') return electron
      if (name === 'electron-squirrel-startup') return false
      if (name === './mcBridge') return { registerMinecraftIpc() {} }
      if (name === './appUpdates')
        return {
          checkForUpdates: async () => updateResult,
          RELEASES_URL: 'https://github.com/0xmthan/Ryksu/releases',
        }
      return require(name)
    },
    process: {
      emitWarning() {},
      versions: { electron: '44.5.1', chrome: '148', node: '22' },
      platform: 'darwin',
      arch: 'arm64',
    },
    console: { log() {} },
  })
  return { handlers, opened, copied: () => copied }
}

test('update IPC opens the fixed releases page only for a newer version', async () => {
  const available = mainHandlers({ status: 'available', version: '2.2.0' })
  await available.handlers.get('app:checkForUpdates')()
  assert.deepEqual(available.opened, ['https://github.com/0xmthan/Ryksu/releases'])
  for (const status of ['current', 'no-release', 'error']) {
    const other = mainHandlers({ status })
    await other.handlers.get('app:checkForUpdates')()
    assert.deepEqual(other.opened, [])
  }
  const failed = mainHandlers({ status: 'available', version: '2.2.0' }, true)
  assert.equal((await failed.handlers.get('app:checkForUpdates')()).status, 'error')
})

test('copy info IPC copies the running version and system details', () => {
  const main = mainHandlers({ status: 'current' })
  assert.equal(main.handlers.get('app:copyInfo')().ok, true)
  assert.equal(
    main.copied(),
    'Ryksu 2.1.0\nPlatform: darwin / arm64\nElectron: 44.5.1\nChromium: 148\nNode.js: 22'
  )
})
