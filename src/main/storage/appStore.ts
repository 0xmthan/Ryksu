import { getSecret, serverPasswordName, setSecret } from './secrets'
import { listFiles, listFolders, readJson, removeFile, serverFolder, writeJson } from './ryksuHome'

// The window's saves (it used to keep them in localStorage), by the same keys, in ~/.ryksu: app-wide ones in
// settings.json, per-server ones in the server's folder. Values come and go as JSON text, as localStorage had
// them. The saved server password goes to the Keychain instead of settings.json.
const CONNECTION = 'ryksu:lastConnection'
const LOCATIONS = 'ryksu:locations:'
const CHAT = 'ryksu:chat:'

// Window keys kept in settings.json, and the field each one goes in.
const SETTINGS_FIELDS: Record<string, string> = {
  [CONNECTION]: 'connection',
  'ryksu:pluginPreferences': 'plugins',
  'ryksu:graphics': 'graphics',
  trustedPlayers: 'trustedPlayers',
  'ryksu.mining.ores': 'miningOres',
  'ryksu.mining.blocks': 'miningBlocks',
}

const SETTINGS = 'settings.json'

export type Settings = Record<string, unknown> & {
  unlimitedFps?: boolean
  controlApi?: { enabled: boolean }
  // When saves from older versions were moved here.
  migrated?: { dataFolder?: string }
  // Window keys with no field of their own.
  window?: Record<string, unknown>
}

export const readSettings = () => readJson<Settings>(SETTINGS, {})

export const updateSettings = (change: (settings: Settings) => void) => {
  const settings = readSettings()
  change(settings)
  writeJson(SETTINGS, settings)
}

// "host:port" back from a server folder name ("host_port").
const serverOf = (folder: string) => {
  const split = folder.lastIndexOf('_')
  return split > 0 ? `${folder.slice(0, split)}:${folder.slice(split + 1)}` : folder
}

// Where a per-server key lives: its server folder's file.
const serverFile = (key: string): string | null => {
  if (key.startsWith(LOCATIONS)) {
    return `servers/${serverFolder(key.slice(LOCATIONS.length))}/locations.json`
  }
  if (key.startsWith(CHAT)) {
    // ryksu:chat:<account>:<host>:<port>
    const [account, ...server] = key.slice(CHAT.length).split(':')
    return `servers/${serverFolder(server.join(':'))}/chat-${account}.json`
  }
  return null
}

type Connection = { host?: string; port?: string; username?: string; offlinePassword?: string }

const passwordName = ({ host = 'localhost', port = '25565', username = '' }: Connection) =>
  serverPasswordName(host, port, username)

// Every saved value by window key, as JSON text.
export const loadWindowStore = (): Record<string, string> => {
  const values: Record<string, unknown> = {}
  const settings = readSettings()
  for (const [key, field] of Object.entries(SETTINGS_FIELDS)) {
    if (settings[field] !== undefined) values[key] = settings[field]
  }
  Object.assign(values, settings.window ?? {})

  const connection = values[CONNECTION] as Connection | undefined
  if (connection) {
    const password = getSecret(passwordName(connection))
    if (password) values[CONNECTION] = { ...connection, offlinePassword: password }
  }

  for (const folder of listFolders('servers')) {
    const server = serverOf(folder)
    for (const file of listFiles(`servers/${folder}`)) {
      if (file === 'locations.json') {
        values[`${LOCATIONS}${server}`] = readJson(`servers/${folder}/${file}`, [])
      }
      const chat = file.match(/^chat-(.+)\.json$/)
      if (chat) values[`${CHAT}${chat[1]}:${server}`] = readJson(`servers/${folder}/${file}`, [])
    }
  }

  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]))
}

// Saves one window value (JSON text), or removes it with null.
export const setWindowValue = (key: string, text: string | null) => {
  let value: unknown = null
  if (text !== null) {
    try {
      value = JSON.parse(text)
    } catch {
      value = text
    }
  }

  const file = serverFile(key)
  if (file) {
    if (text === null) removeFile(file)
    else writeJson(file, value)
    return
  }

  if (key === CONNECTION && value && typeof value === 'object') {
    const { offlinePassword, ...connection } = value as Connection
    setSecret(passwordName(connection), offlinePassword ?? null)
    value = connection
  }

  updateSettings((settings) => {
    const field = SETTINGS_FIELDS[key]
    if (field) {
      if (text === null) delete settings[field]
      else settings[field] = value
      return
    }
    const window = (settings.window ??= {})
    if (text === null) delete window[key]
    else window[key] = value
  })
}
