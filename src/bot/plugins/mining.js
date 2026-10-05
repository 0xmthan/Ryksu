const { Vec3 } = require('vec3')
const { goals } = require('./core/pathfinder')

// Ore choices shown in the UI, each mapped to the block names that count as that ore.
const ORE_BLOCKS = {
  coal: ['coal_ore', 'deepslate_coal_ore'],
  copper: ['copper_ore', 'deepslate_copper_ore'],
  iron: ['iron_ore', 'deepslate_iron_ore'],
  gold: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
  redstone: ['redstone_ore', 'deepslate_redstone_ore'],
  lapis: ['lapis_ore', 'deepslate_lapis_ore'],
  diamond: ['diamond_ore', 'deepslate_diamond_ore'],
  emerald: ['emerald_ore', 'deepslate_emerald_ore'],
  quartz: ['nether_quartz_ore'],
  debris: ['ancient_debris'],
}

const ORE_SEARCH_RADIUS = 48
const CHEST_NAMES = ['chest', 'trapped_chest', 'barrel']
// Head back to the chest once this few inventory slots are left.
const MIN_FREE_SLOTS = 3
// Picked blocks are capped so a typo-free but huge list can't flood findBlocks.
const MAX_CUSTOM_BLOCKS = 64
const DROP_PICKUP_RADIUS = 5
const FAILED_BLOCK_COOLDOWN_MS = 60000
const BUSY_RETRY_MS = 1000
const IDLE_RETRY_MS = 5000
const PATH_TIMEOUT_MS = 30000
// Pathfinder scaffolds with these, so a stack stays in the inventory.
const SCAFFOLD_ITEMS = ['cobblestone', 'cobbled_deepslate', 'dirt', 'netherrack']
const SCAFFOLD_RESERVE = 64

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const withTimeout = (promise, ms, message) => {
  let timer
  // The losing promise still settles later; keep that from surfacing as an unhandled rejection.
  promise.catch(() => {})
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const posKey = (pos) => `${pos.x},${pos.y},${pos.z}`

class MiningController {
  constructor({ pathfinder, autoTool, isBusy, onStop, onUpdate }) {
    this.pathfinder = pathfinder
    this.autoTool = autoTool
    this.isBusy = isBusy ?? (() => false)
    this.onStop = onStop
    this.onUpdate = onUpdate
    this.bot = null
    this.running = false
    this.runId = 0
    this.ores = []
    this.blocks = []
    // Chests picked by hand in the 3D view; loot only goes into these.
    this.chests = []
    this.mined = 0
    this.deposited = 0
    this.status = 'Idle'
    this.failedBlocks = new Map()
  }

  attach(bot) {
    this.bot = bot
  }

  detach() {
    this.running = false
    this.runId++
    this.bot = null
    this.status = 'Idle'
  }

  getState() {
    return {
      active: this.running,
      ores: [...this.ores],
      blocks: [...this.blocks],
      chests: this.chests.map(({ x, y, z }) => ({ x, y, z })),
      mined: this.mined,
      deposited: this.deposited,
      status: this.status,
    }
  }

  // Every block the bot can break, for the block picker.
  getMineableBlocks() {
    const bot = this.bot
    if (!bot?.registry) {
      return []
    }
    return bot.registry.blocksArray
      .filter((block) => block.diggable)
      .map((block) => ({ name: block.name, displayName: block.displayName ?? block.name }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }

  start({ ores, blocks } = {}) {
    const bot = this.bot
    if (!bot?.entity) {
      throw new Error('The bot is not in the world yet.')
    }
    if (this.running) {
      throw new Error('Already mining.')
    }

    const selectedOres = (Array.isArray(ores) ? ores : []).filter((ore) => ORE_BLOCKS[ore])
    const selectedBlocks = [...new Set(Array.isArray(blocks) ? blocks : [])]
      .filter((name) => bot.registry.blocksByName[name]?.diggable)
      .slice(0, MAX_CUSTOM_BLOCKS)
    if (selectedOres.length === 0 && selectedBlocks.length === 0) {
      throw new Error('Pick at least one ore or block to mine.')
    }

    this.ores = selectedOres
    this.blocks = selectedBlocks
    this.mined = 0
    this.deposited = 0
    this.failedBlocks.clear()
    this.running = true
    const runId = ++this.runId
    this._setStatus('Starting…')
    this._loop(runId)
    return this.getState()
  }

  // `automatic` is set when mining ends on its own (full inventory, missing tool, …) rather than on request.
  // Adds the chest at `position` to the deposit list, or removes it if it's already there.
  toggleChest(position) {
    const bot = this.bot
    if (!bot) {
      throw new Error('The bot is not connected.')
    }
    const { x, y, z } = position ?? {}
    if (![x, y, z].every(Number.isInteger)) {
      throw new Error('Invalid block position.')
    }
    const index = this.chests.findIndex((chest) => chest.x === x && chest.y === y && chest.z === z)
    if (index !== -1) {
      this.chests.splice(index, 1)
      this.onUpdate?.()
      return { added: false, state: this.getState() }
    }
    const block = bot.blockAt(new Vec3(x, y, z))
    if (!block || !CHEST_NAMES.includes(block.name)) {
      throw new Error('Only chests, trapped chests and barrels can store loot.')
    }
    this.chests.push(block.position.clone())
    this.onUpdate?.()
    return { added: true, state: this.getState() }
  }

  clearChests() {
    this.chests = []
    this.onUpdate?.()
    return this.getState()
  }

  stop(reason = 'Stopped.', { automatic = false } = {}) {
    if (!this.running) {
      return this.getState()
    }
    this.running = false
    this.runId++
    this.pathfinder.clearTemporaryGoal()
    try {
      this.bot?.stopDigging()
    } catch {
      // not digging
    }
    this._setStatus(reason)
    this.onStop?.(reason, { automatic })
    return this.getState()
  }

  async _loop(runId) {
    const alive = () => this.running && this.runId === runId && this.bot

    while (alive()) {
      try {
        if (this.isBusy() || this.bot.isSleeping) {
          this._setStatus('Paused (busy fighting or fleeing)')
          await sleep(BUSY_RETRY_MS)
          continue
        }

        const hasChest = this.chests.length > 0
        if (!hasChest && this._freeSlots() === 0) {
          throw new Error('STOP: Inventory is full.')
        }
        if (hasChest && this._freeSlots() < MIN_FREE_SLOTS) {
          await this._depositAll(alive)
          continue
        }

        const ore = this._findOre()
        if (!ore) {
          if (hasChest && this._hasLoot()) {
            await this._depositAll(alive)
          }
          this._setStatus(`No ${this._targetLabel()} within ${ORE_SEARCH_RADIUS} blocks. Waiting…`)
          await sleep(IDLE_RETRY_MS)
          continue
        }

        await this._mineBlock(ore, alive)
      } catch (error) {
        if (!alive()) {
          return
        }
        const message = error?.message ?? String(error)
        if (message.startsWith('STOP:')) {
          this.stop(message.slice(5).trim(), { automatic: true })
          return
        }
        console.error('[Mining] step failed', error)
        this._setStatus(`Retrying: ${message}`)
        await sleep(BUSY_RETRY_MS)
      }
    }
  }

  async _mineBlock(block, alive) {
    const bot = this.bot
    const label = block.displayName ?? block.name
    const { x, y, z } = block.position
    this._setStatus(`Walking to ${label} at ${x} ${y} ${z}`)

    try {
      await this._goto(new goals.GoalGetToBlock(x, y, z))
    } catch (error) {
      this._markFailed(block.position)
      throw error
    }
    if (!alive()) {
      return
    }

    // The block may have changed while walking (someone else mined it, gravel fell, …).
    const current = bot.blockAt(block.position)
    if (!current || current.name !== block.name) {
      return
    }

    const tool = await this._equipTool(current)
    if (!current.canHarvest(tool?.type ?? null)) {
      throw new Error(`STOP: The bot has no tool that can mine ${label}.`)
    }

    this._setStatus(`Mining ${label}`)
    await bot.dig(current, true)
    this.mined++
    await this._collectDrops(block.position, alive)
  }

  async _equipTool(block) {
    const bot = this.bot
    if (this.autoTool && !bot.tool) {
      await this.autoTool._ensurePlugin()
    }
    if (bot.tool) {
      try {
        await bot.tool.equipForBlock(block, { requireHarvest: true })
      } catch {
        // No harvesting tool; canHarvest below reports it.
      }
    }
    return bot.heldItem
  }

  async _collectDrops(origin, alive) {
    const bot = this.bot
    await sleep(250)
    for (let i = 0; i < 4 && alive(); i++) {
      const drop = Object.values(bot.entities).find(
        (entity) =>
          entity?.name === 'item' &&
          entity.isValid &&
          entity.position.distanceTo(origin) <= DROP_PICKUP_RADIUS
      )
      if (!drop) {
        return
      }
      this._setStatus('Picking up drops')
      const { x, y, z } = drop.position.floored()
      try {
        await this._goto(new goals.GoalBlock(x, y, z), 8000)
      } catch {
        return
      }
      await sleep(200)
    }
  }

  // Fills the picked chests nearest first, moving on when one is full or gone.
  async _depositAll(alive) {
    const bot = this.bot
    if (this.chests.length === 0) {
      throw new Error('STOP: No chest picked.')
    }
    if (this._depositPlan().length === 0) {
      throw new Error('STOP: Inventory is full of gear it keeps (tools, armor, food).')
    }

    const origin = bot.entity.position
    const queue = [...this.chests].sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin))
    for (const chest of queue) {
      if (!alive()) {
        return
      }
      const label = `${chest.x} ${chest.y} ${chest.z}`
      this._setStatus(`Inventory full, going to the chest at ${label}`)
      try {
        await this._goto(new goals.GoalGetToBlock(chest.x, chest.y, chest.z))
      } catch (error) {
        console.error(`[Mining] could not reach the chest at ${label}`, error)
        continue
      }
      if (!alive()) {
        return
      }

      const chestBlock = bot.blockAt(chest)
      if (!chestBlock || !CHEST_NAMES.includes(chestBlock.name)) {
        continue
      }

      this._setStatus(`Putting items in the chest at ${label}`)
      if (await this._depositInto(chestBlock, alive)) {
        return
      }
    }
    throw new Error(
      this.chests.length === 1 ? 'STOP: The chest is full or unreachable.' : 'STOP: All picked chests are full or unreachable.'
    )
  }

  // True once everything that should go is stored; false if this chest filled up first.
  async _depositInto(chestBlock, alive) {
    const container = await this.bot.openContainer(chestBlock)
    try {
      for (const { type, count, name } of this._depositPlan()) {
        if (!alive()) {
          return true
        }
        try {
          await container.deposit(type, null, count)
          this.deposited += count
        } catch (error) {
          if (/full/i.test(error?.message ?? '')) {
            return false
          }
          console.error(`[Mining] could not deposit ${name}`, error)
        }
      }
      return true
    } finally {
      container.close()
    }
  }

  // Everything except gear, food, and a stack of scaffolding blocks.
  _depositPlan() {
    const bot = this.bot
    const totals = new Map()
    for (const item of bot.inventory.items()) {
      if (this._shouldKeep(item)) {
        continue
      }
      const entry = totals.get(item.type) ?? { type: item.type, name: item.name, count: 0 }
      entry.count += item.count
      totals.set(item.type, entry)
    }

    const plan = []
    for (const entry of totals.values()) {
      if (SCAFFOLD_ITEMS.includes(entry.name)) {
        entry.count -= SCAFFOLD_RESERVE
      }
      if (entry.count > 0) {
        plan.push(entry)
      }
    }
    return plan
  }

  _hasLoot() {
    return this._depositPlan().length > 0
  }

  _shouldKeep(item) {
    const name = item.name
    return (
      /_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$/.test(name) ||
      [
        'shield',
        'bow',
        'crossbow',
        'trident',
        'mace',
        'torch',
        'elytra',
        'shears',
        'flint_and_steel',
      ].includes(name) ||
      name.endsWith('_bed') ||
      Boolean(this.bot.registry.foodsByName?.[name])
    )
  }

  async _goto(goal, timeout = PATH_TIMEOUT_MS) {
    try {
      await withTimeout(this.pathfinder.goto(goal), timeout, 'Took too long to get there.')
    } catch (error) {
      this.pathfinder.clearTemporaryGoal()
      throw error
    }
  }

  _findOre() {
    const bot = this.bot
    const now = Date.now()
    const ids = [...this.ores.flatMap((ore) => ORE_BLOCKS[ore]), ...this.blocks]
      .map((name) => bot.registry.blocksByName[name]?.id)
      .filter((id) => id !== undefined)

    const positions = bot.findBlocks({ matching: ids, maxDistance: ORE_SEARCH_RADIUS, count: 32 })
    for (const position of positions) {
      // Never dig up the chest the loot goes into, even if chests were picked.
      if (this.chests.some((chest) => chest.equals(position))) {
        continue
      }
      const failedAt = this.failedBlocks.get(posKey(position))
      if (failedAt && now - failedAt < FAILED_BLOCK_COOLDOWN_MS) {
        continue
      }
      const block = bot.blockAt(position)
      if (block) {
        return block
      }
    }
    return null
  }


  _targetLabel() {
    const bot = this.bot
    const names = [
      ...this.ores.map((ore) => `${ore} ore`),
      ...this.blocks.map((name) => bot?.registry.blocksByName[name]?.displayName ?? name),
    ]
    return names.length > 3 ? `${names.slice(0, 3).join('/')} or ${names.length - 3} more` : names.join('/')
  }

  _markFailed(position) {
    this.failedBlocks.set(posKey(position), Date.now())
  }

  _freeSlots() {
    return this.bot.inventory.emptySlotCount()
  }

  _setStatus(status) {
    if (this.status === status) {
      return
    }
    this.status = status
    this.onUpdate?.()
  }
}

module.exports = { MiningController, ORE_BLOCKS }
