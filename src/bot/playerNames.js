// Names for player UUIDs, for pets whose owner isn't online. Every name and UUID the server shows while
// the bot is on is remembered per server (in the app's data folder). Offline-mode UUIDs are a hash of the
// name, so they can't be reversed, but any name met anywhere (remembered players, chat) can be hashed and
// compared.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const FILE = 'player-names.json'
const SAVE_DELAY_MS = 2000

const plainUuid = (uuid) => String(uuid).replace(/-/g, '').toLowerCase()

// The game's offline UUID: version-3 (MD5) UUID of "OfflinePlayer:<name>".
const offlineUuid = (name) => {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return bytes.toString('hex')
}

const isOfflineUuid = (uuid) => plainUuid(uuid)[12] === '3'

const dataFolder = () => {
  try {
    return require('electron').app.getPath('userData')
  } catch {
    return null
  }
}

let store = null
let saveTimer = null

const load = () => {
  if (store) return store
  store = {}
  const folder = dataFolder()
  if (!folder) return store
  try {
    store = JSON.parse(fs.readFileSync(path.join(folder, FILE), 'utf8')) || {}
  } catch {
    // First run, or an unreadable file: start over.
  }
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
const serverMemory = (server) => {
  const all = load()
  all[server] ??= { players: {}, names: [] }
  return all[server]
}

const state = new WeakMap()

const nameOf = (record) => (typeof record === 'string' ? record : record?.name)

const remember = (bot, uuid, name) => {
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
const attachPlayerNames = (bot, server) => {
  state.set(bot, { memory: serverMemory(server), hashes: null })
  const note = (player) => remember(bot, player?.uuid, player?.username)
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
const rememberName = (bot, name) => remember(bot, null, name)

// Every known name for this server and others, by its offline UUID.
const offlineHashes = (entry) => {
  if (entry.hashes) return entry.hashes
  const names = new Set()
  for (const memory of Object.values(load())) {
    Object.values(memory.players ?? {}).forEach((record) => names.add(nameOf(record)))
    ;(memory.names ?? []).forEach((name) => names.add(name))
  }
  entry.hashes = new Map([...names].map((name) => [offlineUuid(name), name]))
  return entry.hashes
}

// The name for a UUID and how it was found: online now, seen before, or matched by hashing known names.
const nameForUuid = (bot, uuid) => {
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
const playerList = (bot) => {
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
      name: nameOf(record),
      uuid: id,
      lastSeen: typeof record === 'object' ? (record.lastSeen ?? null) : null,
    }))
    .filter((player) => player.name)
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || a.name.localeCompare(b.name))
  return { online, offline }
}

module.exports = { attachPlayerNames, rememberName, nameForUuid, playerList, offlineUuid, isOfflineUuid }
