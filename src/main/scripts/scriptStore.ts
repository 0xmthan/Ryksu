import fs from 'node:fs'
import type { Script } from '../../shared/types'
import { homePath, listFiles, removeFile, writeFile } from '../storage/ryksuHome'

// The user's scripts.
export type ScriptStore = {
  load(): Script[]
  save(scripts: Script[]): void
}

// The scripts a first run starts with, to show how they look.
export const IRON_FARM_SCRIPT: Script = {
  id: 'iron-farm-afk',
  name: 'Iron farm AFK',
  code: `// Teleports to the iron farm and stands there until you turn it off, then goes home.
// Everything automatic is paused while a script is on; ryksu.setToggle('autoEat', true) would turn one back on.

async function start() {
  ryksu.chat('/wp iron_farm')
  await ryksu.waitForTeleport()
  ryksu.hideWorld()
  ryksu.status('AFK at the iron farm')
}

async function stop() {
  ryksu.chat('/wp home')
  await ryksu.waitForTeleport()
}
`,
}

export const WHEAT_FARM_SCRIPT: Script = {
  id: 'wheat-farm',
  name: 'Wheat farm',
  code: `// One trip to the wheat farm: harvests the ripe wheat, plants every empty farmland, puts the harvest in the
// chest and goes home. Without a chest it keeps the harvest. It doesn't go with a full inventory, and when
// the chest is missing or full it sends a notification and goes home.

// The chest for the harvest, like { x: 120, y: 64, z: -35 }, or null to keep it.
const CHEST = null
// How far from where the waypoint lands the farm reaches.
const FARM_RADIUS = 64
// Seeds go to the chest too; planting takes them back out when it runs short.
const HARVEST = ['wheat', 'wheat_seeds']

const CHESTS = ['chest', 'trapped_chest', 'barrel']
let atFarm = false

async function start() {
  if (ryksu.freeSlots() === 0) ryksu.exit("The inventory is full, so it isn't going.")

  ryksu.status('Going to the wheat farm')
  ryksu.chat('/wp wheat_farm')
  await ryksu.waitForTeleport()
  atFarm = true

  if (CHEST && !CHESTS.includes(ryksu.blockAt(CHEST)?.name)) {
    goHome(\`There's no chest at \${CHEST.x} \${CHEST.y} \${CHEST.z}.\`)
  }

  const harvested = await harvest()
  await plant()
  if (CHEST) await store()
  ryksu.exit(\`Done: harvested \${harvested} wheat.\`)
}

async function stop() {
  if (!atFarm) return
  ryksu.status('Going home')
  ryksu.chat('/wp home')
  await ryksu.waitForTeleport()
}

// Breaks every ripe wheat row by row and picks it all up. Resolves with how many it broke.
async function harvest() {
  const ripe = ryksu.findBlocks('wheat', { maxDistance: FARM_RADIUS, properties: { age: 7 } })
  if (ripe.length === 0) return 0
  ryksu.status(\`Harvesting \${ripe.length} wheat\`)
  const { dug } = await ryksu.digAll(ripe, { order: 'rows' })
  await pickUp()
  // Full before it got everything: empty into the chest and go again.
  if (ryksu.freeSlots() === 0 && CHEST) {
    await store()
    await pickUp()
  }
  return dug
}

async function pickUp() {
  ryksu.status('Picking up the harvest')
  await ryksu.collectDrops({ radius: 32 })
}

// Plants seeds on every empty farmland, taking more from the chest when it's short.
async function plant() {
  const empty = ryksu
    .findBlocks('farmland', { maxDistance: FARM_RADIUS })
    .filter((land) => ryksu.blockAt({ x: land.x, y: land.y + 1, z: land.z })?.name === 'air')
  if (empty.length === 0) return
  if (CHEST && seeds() < empty.length) {
    ryksu.status('Getting seeds from the chest')
    await ryksu.withdraw(CHEST, { wheat_seeds: empty.length - seeds() })
  }
  if (seeds() === 0) {
    ryksu.log(\`No seeds for the \${empty.length} empty farmland.\`)
    return
  }
  ryksu.status(\`Planting \${empty.length} seeds\`)
  const { used, skipped } = await ryksu.useItemOnAll(empty, 'wheat_seeds', { order: 'rows' })
  ryksu.log(\`Planted \${used} of \${empty.length} empty farmland\${skipped ? \`, \${skipped} out of reach\` : ''}.\`)
}

// Puts the harvest in the chest; goes home if it didn't all fit.
async function store() {
  ryksu.status('Putting the harvest in the chest')
  const stored = await ryksu.deposit(CHEST, { only: HARVEST })
  ryksu.log(\`Put \${stored} items in the chest.\`)
  if (ryksu.inventory().some((item) => HARVEST.includes(item.name))) goHome('The chest is full.')
}

const seeds = () => ryksu.inventory().find((item) => item.name === 'wheat_seeds')?.count ?? 0

// Something's wrong: tell the user, and turn off (stop() takes it home).
function goHome(problem) {
  ryksu.notify(\`\${problem} Going home.\`)
  ryksu.exit()
}
`,
}

const EXAMPLE_SCRIPTS = [IRON_FARM_SCRIPT, WHEAT_FARM_SCRIPT]

const FOLDER = 'scripts'

// A script's file name: its name, minus characters a file name can't have, made unique.
const fileNames = (scripts: Script[]) => {
  const used = new Set<string>()
  return scripts.map(({ name }) => {
    const base = name.replace(/[/\\:*?"<>|]+/g, '-').trim() || 'Untitled script'
    let file = `${base}.js`
    for (let copy = 2; used.has(file.toLowerCase()); copy++) file = `${base} (${copy}).js`
    used.add(file.toLowerCase())
    return file
  })
}

// Each script is a .js file in ~/.ryksu/scripts, named after it, so it can be edited and backed up outside
// the app too. A first run starts with the examples.
export const fileScriptStore: ScriptStore = {
  load() {
    if (!fs.existsSync(homePath(FOLDER))) {
      const examples = EXAMPLE_SCRIPTS.map((script) => ({ ...script }))
      fileScriptStore.save(examples)
      return examples
    }
    return listFiles(FOLDER)
      .filter((file) => file.endsWith('.js'))
      .sort((a, b) => a.localeCompare(b))
      .map((file) => {
        const name = file.slice(0, -'.js'.length)
        return { id: name, name, code: fs.readFileSync(homePath(FOLDER, file), 'utf8') }
      })
  },
  save(scripts) {
    try {
      const files = fileNames(scripts)
      scripts.forEach((script, index) => writeFile(`${FOLDER}/${files[index]}`, script.code))
      const kept = new Set(files)
      for (const file of listFiles(FOLDER)) {
        if (file.endsWith('.js') && !kept.has(file)) removeFile(`${FOLDER}/${file}`)
      }
    } catch (error) {
      console.error('[Scripts] Could not save the scripts', error)
    }
  },
}
