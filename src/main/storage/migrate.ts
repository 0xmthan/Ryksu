import fs from 'node:fs'
import path from 'node:path'
import type { Script } from '../../shared/types'
import { fileScriptStore } from '../scripts/scriptStore'
import { loadWindowStore, readSettings, setWindowValue, updateSettings } from './appStore'
import { homePath, serverFolder, writeJson } from './ryksuHome'

const readOld = (folder: string, file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'))
  } catch {
    return undefined
  }
}

// Moves what older versions saved in the app's data folder into ~/.ryksu, once. The old files stay where
// they were, as a backup.
export const migrateDataFolder = (dataFolder: string) => {
  if (readSettings().migrated?.dataFolder) return

  const scripts = readOld(dataFolder, 'scripts.json')
  if (Array.isArray(scripts) && !fs.existsSync(homePath('scripts'))) {
    fileScriptStore.save(scripts as Script[])
  }

  const chests = readOld(dataFolder, 'mining-chests.json')
  for (const [server, list] of Object.entries((chests ?? {}) as Record<string, unknown>)) {
    const file = `servers/${serverFolder(server)}/mining-chests.json`
    if (Array.isArray(list) && list.length > 0 && !fs.existsSync(homePath(file))) writeJson(file, list)
  }

  const names = readOld(dataFolder, 'player-names.json')
  if (names && !fs.existsSync(homePath('cache/player-names.json')))
    writeJson('cache/player-names.json', names)

  const display = readOld(dataFolder, 'display.json') as { unlimitedFps?: unknown } | undefined
  const controlApi = readOld(dataFolder, 'control-api.json') as { enabled?: unknown } | undefined
  updateSettings((settings) => {
    if (settings.unlimitedFps === undefined && display) settings.unlimitedFps = display.unlimitedFps === true
    if (settings.controlApi === undefined && controlApi)
      settings.controlApi = { enabled: controlApi.enabled === true }
    settings.migrated = { ...settings.migrated, dataFolder: new Date().toISOString() }
  })
}

// Takes the window's old localStorage saves (sent once by the preload), keeping anything already in
// ~/.ryksu. Locations used to be one list for every server; they go to the last server connected to.
export const importWindowStorage = (entries: Record<string, string>) => {
  const existing = loadWindowStore()
  const imported: string[] = []
  for (const [key, text] of Object.entries(entries)) {
    let target = key
    if (key === 'savedLocations') {
      const connection = JSON.parse(
        entries['ryksu:lastConnection'] ?? existing['ryksu:lastConnection'] ?? '{}'
      )
      target = `ryksu:locations:${(connection.host || 'localhost').trim().toLowerCase()}:${connection.port || '25565'}`
    }
    if (target in existing) continue
    setWindowValue(target, text)
    imported.push(key)
  }
  return imported
}
