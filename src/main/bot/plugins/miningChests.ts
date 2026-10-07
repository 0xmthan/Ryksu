import { readJson, removeFile, serverFolder, writeJson } from '../../storage/ryksuHome'

// Auto Mine's loot chests, remembered per server ("host:port") in its folder in ~/.ryksu, each with the
// dimension it's in so an Overworld chest is never looked for in the Nether.
export type SavedChest = { x: number; y: number; z: number; dimension: string }

export type ChestStore = {
  load(server: string): SavedChest[]
  save(server: string, chests: SavedChest[]): void
}

const isChest = (value: unknown): value is SavedChest => {
  const chest = value as Partial<SavedChest> | null
  return (
    Boolean(chest) &&
    [chest!.x, chest!.y, chest!.z].every(Number.isInteger) &&
    typeof chest!.dimension === 'string'
  )
}

const file = (server: string) => `servers/${serverFolder(server)}/mining-chests.json`

export const fileChestStore: ChestStore = {
  load(server) {
    const chests = readJson<unknown>(file(server), [])
    return Array.isArray(chests) ? chests.filter(isChest).map((chest) => ({ ...chest })) : []
  },
  save(server, chests) {
    try {
      if (chests.length > 0) writeJson(file(server), chests)
      else removeFile(file(server))
    } catch (error) {
      console.error('[Mining] Could not save the loot chests', error)
    }
  },
}
