import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadWindowStore, readSettings, setWindowValue } from '../src/main/storage/appStore'
import { importWindowStorage, migrateDataFolder } from '../src/main/storage/migrate'
import { fileChestStore } from '../src/main/bot/plugins/miningChests'
import { fileScriptStore } from '../src/main/scripts/scriptStore'
import { createAppStore } from '../src/preload/appStore'

// Each test gets its own empty ~/.ryksu.
const freshHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ryksu-home-'))
  process.env.RYKSU_HOME = home
  return home
}

const read = (home: string, file: string) => fs.readFileSync(path.join(home, file), 'utf8')

test('window saves land in settings.json and the server folders, and load back', () => {
  const home = freshHome()
  setWindowValue('ryksu:graphics', JSON.stringify({ shadows: 'low' }))
  setWindowValue('ryksu:locations:play.example.com:25565', JSON.stringify([{ id: '1', name: 'Home' }]))
  setWindowValue('ryksu:chat:offline:play.example.com:25565', JSON.stringify([]))

  assert.deepEqual(JSON.parse(read(home, 'settings.json')).graphics, { shadows: 'low' })
  assert.ok(fs.existsSync(path.join(home, 'servers/play.example.com_25565/locations.json')))
  assert.ok(fs.existsSync(path.join(home, 'servers/play.example.com_25565/chat-offline.json')))
  assert.deepEqual(Object.keys(loadWindowStore()).sort(), [
    'ryksu:chat:offline:play.example.com:25565',
    'ryksu:graphics',
    'ryksu:locations:play.example.com:25565',
  ])

  setWindowValue('ryksu:locations:play.example.com:25565', null)
  assert.ok(!fs.existsSync(path.join(home, 'servers/play.example.com_25565/locations.json')))
})

test('the saved server password never reaches settings.json', () => {
  const home = freshHome()
  const connection = { host: 'siyen.net', port: '25565', username: 'Ryksu', offlinePassword: 'hunter2' }
  setWindowValue('ryksu:lastConnection', JSON.stringify(connection))

  assert.doesNotMatch(read(home, 'settings.json'), /hunter2/)
  // Without Electron's encryption (as in tests) it isn't written anywhere, but lasts for this run.
  assert.ok(!fs.existsSync(path.join(home, 'secrets/passwords.json')))
  assert.deepEqual(JSON.parse(loadWindowStore()['ryksu:lastConnection']), connection)
})

test("the old data folder's saves move to ~/.ryksu once, and the old files stay", () => {
  const home = freshHome()
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'ryksu-userdata-'))
  const write = (file: string, data: unknown) => fs.writeFileSync(path.join(old, file), JSON.stringify(data))
  write('scripts.json', [{ id: 'a', name: 'Farm', code: 'async function start() {}' }])
  write('mining-chests.json', { 'siyen.net:25565': [{ x: 1, y: 2, z: 3, dimension: 'overworld' }] })
  write('display.json', { unlimitedFps: true })
  write('control-api.json', { enabled: true })

  migrateDataFolder(old)
  assert.equal(read(home, 'scripts/Farm.js'), 'async function start() {}')
  assert.deepEqual(fileChestStore.load('siyen.net:25565'), [{ x: 1, y: 2, z: 3, dimension: 'overworld' }])
  assert.equal(readSettings().unlimitedFps, true)
  assert.deepEqual(readSettings().controlApi, { enabled: true })
  assert.ok(fs.existsSync(path.join(old, 'scripts.json')))

  write('display.json', { unlimitedFps: false })
  migrateDataFolder(old)
  assert.equal(readSettings().unlimitedFps, true)
})

test("the window's old localStorage moves over without overwriting newer saves", () => {
  freshHome()
  setWindowValue('ryksu:graphics', JSON.stringify({ shadows: 'high' }))
  const imported = importWindowStorage({
    'ryksu:graphics': JSON.stringify({ shadows: 'off' }),
    'ryksu:lastConnection': JSON.stringify({ host: 'Siyen.net', port: '25565', username: 'Ryksu' }),
    savedLocations: JSON.stringify([{ id: '1', name: 'Home', x: 1, y: 2, z: 3 }]),
  })
  assert.deepEqual(imported.sort(), ['ryksu:lastConnection', 'savedLocations'])
  const saved = loadWindowStore()
  assert.deepEqual(JSON.parse(saved['ryksu:graphics']), { shadows: 'high' })
  assert.equal(JSON.parse(saved['ryksu:locations:siyen.net:25565'])[0].name, 'Home')
})

test('the preload sends old localStorage saves once, clears them, and reads like localStorage', () => {
  const old = new Map([
    ['ryksu:graphics', '{}'],
    ['ryksu.scripts.helpOpen', 'true'],
  ])
  const sent: unknown[][] = []
  const store = createAppStore(
    {
      sendSync: (channel, ...args) => {
        sent.push([channel, ...args])
        return channel === 'store:load' ? { 'ryksu:graphics': '{}' } : []
      },
      send: (channel, ...args) => sent.push([channel, ...args]),
    },
    {
      get length() {
        return old.size
      },
      key: (index) => [...old.keys()][index] ?? null,
      getItem: (key) => old.get(key) ?? null,
      removeItem: (key) => void old.delete(key),
    }
  )
  assert.deepEqual(sent[0], ['store:import', { 'ryksu:graphics': '{}' }])
  // Only the saves it moved leave localStorage.
  assert.deepEqual([...old.keys()], ['ryksu.scripts.helpOpen'])
  assert.equal(store.getItem('ryksu:graphics'), '{}')
  store.setItem('trustedPlayers', '["Steve"]')
  assert.equal(store.getItem('trustedPlayers'), '["Steve"]')
  assert.deepEqual(sent.at(-1), ['store:set', 'trustedPlayers', '["Steve"]'])
})

test('scripts are .js files named after them; renaming moves the file', () => {
  const home = freshHome()
  fileScriptStore.save([
    { id: '1', name: 'Wheat farm', code: 'a' },
    { id: '2', name: 'Wheat farm', code: 'b' },
  ])
  assert.deepEqual(fs.readdirSync(path.join(home, 'scripts')).sort(), ['Wheat farm (2).js', 'Wheat farm.js'])
  fileScriptStore.save([{ id: '1', name: 'Farm: wheat', code: 'a' }])
  assert.deepEqual(fs.readdirSync(path.join(home, 'scripts')), ['Farm- wheat.js'])
  assert.deepEqual(fileScriptStore.load(), [{ id: 'Farm- wheat', name: 'Farm- wheat', code: 'a' }])
})
