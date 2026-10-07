// The window's saves, kept in ~/.ryksu by the main process (src/main/storage/appStore.ts) and read like
// localStorage: all of them load once, synchronously, so reads stay synchronous; changes go back as they happen.
// Built apart from the preload so it can be tested without Electron.
export type SyncIpcLike = {
  sendSync(channel: string, ...args: unknown[]): unknown
  send(channel: string, ...args: unknown[]): void
}

// What older versions kept in the window's localStorage, moved to ~/.ryksu once.
const OLD_KEYS = [
  'ryksu:lastConnection',
  'ryksu:pluginPreferences',
  'ryksu:graphics',
  'trustedPlayers',
  'ryksu.mining.ores',
  'ryksu.mining.blocks',
  'savedLocations',
]
const OLD_PREFIXES = ['ryksu:chat:']

type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'key' | 'length'>

const oldSaves = (storage: StorageLike) => {
  const entries: Record<string, string> = {}
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key || !(OLD_KEYS.includes(key) || OLD_PREFIXES.some((prefix) => key.startsWith(prefix)))) continue
    const value = storage.getItem(key)
    if (value !== null) entries[key] = value
  }
  return entries
}

export const createAppStore = (ipc: SyncIpcLike, storage: StorageLike | null) => {
  // Older saves go first; what's already in ~/.ryksu wins. Then they leave localStorage (the saved password
  // most of all).
  const old = storage ? oldSaves(storage) : {}
  if (Object.keys(old).length > 0) {
    ipc.sendSync('store:import', old)
    for (const key of Object.keys(old)) storage!.removeItem(key)
  }

  const values = new Map(Object.entries((ipc.sendSync('store:load') ?? {}) as Record<string, string>))

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, String(value))
      ipc.send('store:set', key, String(value))
    },
    removeItem: (key: string) => {
      values.delete(key)
      ipc.send('store:set', key, null)
    },
    keys: () => [...values.keys()],
  }
}

export type AppStore = ReturnType<typeof createAppStore>
