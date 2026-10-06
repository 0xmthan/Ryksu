// Names for player UUIDs, for pets whose owner isn't online. Every name and UUID the server shows while
// the bot is on is remembered per server (in the app's data folder). Offline-mode UUIDs are a hash of the
// name, so they can't be reversed, but any name met anywhere (remembered players, chat) can be hashed and
// compared.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Bot, Player } from 'mineflayer'
import type { PlayerList } from '../../../shared/types'

// A remembered player: older files stored just the name.
type PlayerRecord = string | { name: string; lastSeen: number | null }
type ServerMemory = { players: Record<string, PlayerRecord>; names: string[] }
type BotEntry = { memory: ServerMemory; hashes: Map<string, string> | null }
export type NameSource = 'online' | 'seen' | 'matched'

const FILE = 'player-names.json'
const SAVE_DELAY_MS = 2000

const plainUuid = (uuid: unknown) => String(uuid).replace(/-/g, '').toLowerCase()

// The game's offline UUID: version-3 (MD5) UUID of "OfflinePlayer:<name>".
export const offlineUuid = (name: string) => {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return bytes.toString('hex')
}

export const isOfflineUuid = (uuid: unknown) => plainUuid(uuid)[12] === '3'

// Required lazily so tests can load this module without Electron.
const dataFolder = (): string | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('electron') as typeof import('electron')).app.getPath('userData')
  } catch {
    return null
  }
}

let store: Record<string, ServerMemory> | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined

const load = (): Record<string, ServerMemory> => {
  if (store) return store
  let loaded: Record<string, ServerMemory> = {}
  const folder = dataFolder()
  if (folder) {
    try {
      loaded = JSON.parse(fs.readFileSync(path.join(folder, FILE), 'utf8')) || {}
    } catch {
      // First run, or an unreadable file: start over.
    }
  }
  store = loaded
  return store
}

const save = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const folder = dataFolder()
    if (!folder) return
    fs.promises
      .writeFile(path.join(folder, FILE), JSON.stringify(store))
      .catch((error) => console.error('[PlayerNames] Could not save', error))
  }, SAVE_DELAY_MS)
}

// One server's memory: UUID → { name, lastSeen } (older files stored just the name), plus names seen
// without a UUID (chat).
const serverMemory = (server: string) => {
  const all = load()
  all[server] ??= { players: {}, names: [] }
  return all[server]
}

const state = new WeakMap<Bot, BotEntry>()

const nameOf = (record: PlayerRecord | undefined) => (typeof record === 'string' ? record : record?.name)

const remember = (bot: Bot, uuid: string | null | undefined, name: unknown) => {
  const entry = state.get(bot)
  if (!entry || typeof name !== 'string' || !name) return
  if (uuid) {
    const id = plainUuid(uuid)
    const known = entry.memory.players[id]
    entry.memory.players[id] = { name, lastSeen: Date.now() }
    // Last-seen times only matter when they leave, so a returning name doesn't need a save.
    if (nameOf(known) === name) return
  } else {
    if (entry.memory.names.includes(name)) return
    entry.memory.names.push(name)
  }
  entry.hashes = null
  save()
}

// Call after creating the bot; `server` is "host:port".
export const attachPlayerNames = (bot: Bot, server: string) => {
  state.set(bot, { memory: serverMemory(server), hashes: null })
  const note = (player: Player | undefined) => remember(bot, player?.uuid, player?.username)
  bot.on('playerJoined', note)
  bot.on('playerUpdated', note)
  bot.on('playerLeft', (player) => {
    note(player)
    save()
  })
  // Everyone still on was last seen now.
  bot.on('end', () => {
    Object.values(bot.players ?? {}).forEach(note)
    save()
  })
  bot.once('spawn', () => Object.values(bot.players ?? {}).forEach(note))
}

// A name met in chat, kept as an offline-UUID candidate.
export const rememberName = (bot: Bot, name: string) => remember(bot, null, name)

// Every known name for this server and others, by its offline UUID.
const offlineHashes = (entry: BotEntry) => {
  if (entry.hashes) return entry.hashes
  const names = new Set<string>()
  for (const memory of Object.values(load())) {
    Object.values(memory.players ?? {}).forEach((record) => {
      const name = nameOf(record)
      if (name) names.add(name)
    })
    ;(memory.names ?? []).forEach((name) => names.add(name))
  }
  entry.hashes = new Map([...names].map((name) => [offlineUuid(name), name]))
  return entry.hashes
}

// The name for a UUID and how it was found: online now, seen before, or matched by hashing known names.
export const nameForUuid = (bot: Bot, uuid: string): { name: string; source: NameSource } | null => {
  const id = plainUuid(uuid)
  const online = Object.values(bot.players ?? {}).find((player) => plainUuid(player.uuid) === id)
  if (online?.username) return { name: online.username, source: 'online' }
  const entry = state.get(bot)
  if (!entry) return null
  const seen = nameOf(entry.memory.players[id])
  if (seen) return { name: seen, source: 'seen' }
  if (isOfflineUuid(id)) {
    const matched = offlineHashes(entry).get(id)
    if (matched) return { name: matched, source: 'matched' }
  }
  return null
}

// For the tab list: who's on now (the bot first), and everyone remembered here who isn't, most recent first.
export const playerList = (bot: Bot): PlayerList => {
  const players = Object.values(bot.players ?? {}).filter((player) => player?.username)
  const onlineIds = new Set(players.map((player) => plainUuid(player.uuid)))
  const online = players
    .map((player) => ({
      name: player.username,
      uuid: plainUuid(player.uuid),
      ping: Number.isFinite(player.ping) ? player.ping : null,
      ...(player.username === bot.username ? { bot: true } : {}),
    }))
    .sort((a, b) => Number(Boolean(b.bot)) - Number(Boolean(a.bot)) || a.name.localeCompare(b.name))
  const memory = state.get(bot)?.memory.players ?? {}
  const offline = Object.entries(memory)
    .filter(([id]) => !onlineIds.has(id))
    .map(([id, record]) => ({
      name: nameOf(record) ?? '',
      uuid: id,
      lastSeen: typeof record === 'object' ? (record.lastSeen ?? null) : null,
    }))
    .filter((player) => player.name)
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || a.name.localeCompare(b.name))
  return { online, offline }
}
