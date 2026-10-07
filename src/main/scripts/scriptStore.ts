import fs from 'node:fs'
import path from 'node:path'
import type { Script } from '../../shared/types'

// The user's scripts, kept in the app's data folder.
export type ScriptStore = {
  load(): Script[]
  save(scripts: Script[]): void
}

const FILE = 'scripts.json'

// The script a first run starts with, to show how one looks.
export const EXAMPLE_SCRIPT: Script = {
  id: 'iron-farm-afk',
  name: 'Iron farm AFK',
  code: `// Teleports to the iron farm and stands there until you turn it off, then goes home.
// Everything automatic is paused while a script is on; ryksu.setToggle('autoEat', true) would turn one back on.

async function start() {
  ryksu.chat('/wp iron_farm')
  await ryksu.waitForTeleport()
  ryksu.status('AFK at the iron farm')
}

async function stop() {
  ryksu.chat('/wp home')
  await ryksu.waitForTeleport()
}
`,
}

// Required lazily so tests can load this module without Electron.
const dataFolder = (): string | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('electron') as typeof import('electron')).app.getPath('userData')
  } catch {
    return null
  }
}

const isScript = (value: unknown): value is Script => {
  const script = value as Partial<Script> | null
  return typeof script?.id === 'string' && typeof script.name === 'string' && typeof script.code === 'string'
}

export const fileScriptStore: ScriptStore = {
  load() {
    const folder = dataFolder()
    if (!folder) return [{ ...EXAMPLE_SCRIPT }]
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(folder, FILE), 'utf8')) as unknown
      return Array.isArray(parsed) ? parsed.filter(isScript) : [{ ...EXAMPLE_SCRIPT }]
    } catch {
      // First run, or an unreadable file.
      return [{ ...EXAMPLE_SCRIPT }]
    }
  },
  save(scripts) {
    const folder = dataFolder()
    if (!folder) return
    fs.promises
      .writeFile(path.join(folder, FILE), JSON.stringify(scripts, null, 2))
      .catch((error) => console.error('[Scripts] Could not save the scripts', error))
  },
}
