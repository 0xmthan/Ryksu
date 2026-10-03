const { goals } = require('mineflayer-pathfinder')

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
const CHEST_SEARCH_RADIUS = 16
const CHEST_NAMES = ['chest', 'trapped_chest', 'barrel']
// Head back to the chest once this few inventory slots are left.
const MIN_FREE_SLOTS = 3
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
    this.chest = null
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
      chest: this.chest ? { x: this.chest.x, y: this.chest.y, z: this.chest.z } : null,
      mined: this.mined,
      deposited: this.deposited,
      status: this.status,
    }
  }

  start({ ores } = {}) {
    const bot = this.bot
    if (!bot?.entity) {
      throw new Error('The bot is not in the world yet.')
    }
    if (this.running) {
      throw new Error('Already mining.')
    }

    const selected = (Array.isArray(ores) ? ores : []).filter((ore) => ORE_BLOCKS[ore])
    if (selected.length === 0) {
      throw new Error('Pick at least one ore to mine.')
    }

    const chest = this._findNearestChest()
    if (!chest) {
      throw new Error(`Stand the bot within ${CHEST_SEARCH_RADIUS} blocks of a chest first.`)
    }

    this.ores = selected
    this.chest = chest.position.clone()
    this.mined = 0
    this.deposited = 0
    this.failedBlocks.clear()
    this.running = true
    const runId = ++this.runId
    this._setStatus('Starting…')
    this._loop(runId)
    return this.getState()
  }

  stop(reason = 'Stopped.') {
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
    this.onStop?.(reason)
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

        if (this._freeSlots() < MIN_FREE_SLOTS) {
          await this._depositAll(alive)
          continue
        }

        const ore = this._findOre()
        if (!ore) {
          if (this._hasLoot()) {
            await this._depositAll(alive)
          }
          this._setStatus(`No ${this.ores.join('/')} ore within ${ORE_SEARCH_RADIUS} blocks. Waiting…`)
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
          this.stop(message.slice(5).trim())
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

  async _depositAll(alive) {
    const bot = this.bot
    if (!this.chest) {
      throw new Error('STOP: No chest set.')
    }
    if (this._depositPlan().length === 0) {
      throw new Error('STOP: Inventory is full of gear it keeps (tools, armor, food).')
    }

    this._setStatus('Inventory full, going to the chest')
    await this._goto(new goals.GoalGetToBlock(this.chest.x, this.chest.y, this.chest.z))
    if (!alive()) {
      return
    }

    const chestBlock = bot.blockAt(this.chest)
    if (!chestBlock || !CHEST_NAMES.includes(chestBlock.name)) {
      throw new Error('STOP: The chest is gone.')
    }

    this._setStatus('Putting items in the chest')
    const container = await bot.openContainer(chestBlock)
    try {
      for (const { type, count, name } of this._depositPlan()) {
        if (!alive()) {
          return
        }
        try {
          await container.deposit(type, null, count)
          this.deposited += count
        } catch (error) {
          if (/full/i.test(error?.message ?? '')) {
            throw new Error('STOP: The chest is full.')
          }
          console.error(`[Mining] could not deposit ${name}`, error)
        }
      }
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
    const ids = this.ores
      .flatMap((ore) => ORE_BLOCKS[ore])
      .map((name) => bot.registry.blocksByName[name]?.id)
      .filter((id) => id !== undefined)

    const positions = bot.findBlocks({ matching: ids, maxDistance: ORE_SEARCH_RADIUS, count: 32 })
    for (const position of positions) {
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

  _findNearestChest() {
    const bot = this.bot
    const ids = CHEST_NAMES.map((name) => bot.registry.blocksByName[name]?.id).filter(
      (id) => id !== undefined
    )
    const position = bot.findBlock({ matching: ids, maxDistance: CHEST_SEARCH_RADIUS })
    return position ?? null
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
