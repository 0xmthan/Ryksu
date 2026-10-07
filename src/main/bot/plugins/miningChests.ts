import fs from 'node:fs'
import path from 'node:path'

// Auto Mine's loot chests, remembered per server ("host:port") in the app's data folder, each with the
// dimension it's in so an Overworld chest is never looked for in the Nether.
export type SavedChest = { x: number; y: number; z: number; dimension: string }

export type ChestStore = {
  load(server: string): SavedChest[]
  save(server: string, chests: SavedChest[]): void
}

const FILE = 'mining-chests.json'

// Required lazily so tests can load this module without Electron.
const dataFolder = (): string | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('electron') as typeof import('electron')).app.getPath('userData')
  } catch {
    return null
  }
}

const isChest = (value: unknown): value is SavedChest => {
  const chest = value as Partial<SavedChest> | null
  return (
    Boolean(chest) &&
    [chest!.x, chest!.y, chest!.z].every(Number.isInteger) &&
    typeof chest!.dimension === 'string'
  )
}

let store: Record<string, SavedChest[]> | null = null

const loadAll = (): Record<string, SavedChest[]> => {
  if (store) return store
  store = {}
  const folder = dataFolder()
  if (folder) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(folder, FILE), 'utf8')) as Record<string, unknown>
      for (const [server, chests] of Object.entries(parsed ?? {})) {
        if (Array.isArray(chests)) store[server] = chests.filter(isChest)
      }
    } catch {
      // First run, or an unreadable file: start over.
    }
  }
  return store
}

export const fileChestStore: ChestStore = {
  load(server) {
    return (loadAll()[server] ?? []).map((chest) => ({ ...chest }))
  },
  save(server, chests) {
    const all = loadAll()
    if (chests.length > 0) all[server] = chests.map((chest) => ({ ...chest }))
    else delete all[server]
    const folder = dataFolder()
    if (!folder) return
    fs.promises
      .writeFile(path.join(folder, FILE), JSON.stringify(all))
      .catch((error) => console.error('[Mining] Could not save the loot chests', error))
  },
}
