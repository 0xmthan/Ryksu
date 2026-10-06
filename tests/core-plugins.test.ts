import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { equipItem } from '../src/bot/plugins/core/armor/lib/equipItem'
import { EatUtil } from '../src/bot/plugins/core/autoEat'
import { Tool } from '../src/bot/plugins/core/tool/Tool'
import { TaskQueue } from '../src/bot/plugins/core/tool/TaskQueue'
import { TemporarySubscriber } from '../src/bot/plugins/core/tool/TemporarySubscriber'
import { AStar } from '../src/bot/plugins/core/pathfinder/lib/astar'
import { Move } from '../src/bot/plugins/core/pathfinder/lib/move'
import { Lock } from '../src/bot/plugins/core/pathfinder/lib/lock'
import { goals } from '../src/bot/plugins/core/pathfinder'
import { goto } from '../src/bot/plugins/core/pathfinder/lib/goto'
import { pathfinder } from '../src/bot/plugins/core/pathfinder'
import type { Movements } from '../src/bot/plugins/core/pathfinder/lib/movements'
import type { LookWorld } from '../src/bot/plugins/core/pathfinder/lib/goals'
import type { Bot } from 'mineflayer'
import loadBlock, { type Block } from 'prismarine-block'
import type { Item } from 'prismarine-item'
import loadRegistry from 'prismarine-registry'
import { asBot, fake, fakeBot } from './fakes'

const item = (fields: object) => fake<Item>(fields)
const nextTurn = () => new Promise((resolve) => setImmediate(resolve))

test('armor upgrades its slot and preserves a stronger equipped item', async () => {
  const iron = item({ type: 1, name: 'iron_helmet' })
  const diamond = item({ type: 2, name: 'diamond_helmet' })
  const inventory = { slots: Array<Item | null>(46).fill(null) }
  inventory.slots[5] = iron
  inventory.slots[9] = diamond
  const calls: [string, string][] = []
  const bot = fake<Bot>({
    inventory,
    supportFeature: () => false,
    equip: async (equipped: Item, destination: string) => {
      calls.push([equipped.name, destination])
      inventory.slots[5] = equipped
    },
  })
  assert.equal(await equipItem(bot, diamond.type), true)
  assert.deepEqual(calls, [['diamond_helmet', 'head']])
  inventory.slots[10] = iron
  assert.equal(await equipItem(bot, iron.type), false)
  assert.equal(await equipItem(bot, 999), false)
})

function eatingBot() {
  const bot = fakeBot()
  const apple = item({ name: 'apple', type: 1, slot: 10 })
  const steak = item({ name: 'cooked_beef', type: 2, slot: 11 })
  const rotten = item({ name: 'rotten_flesh', type: 3, slot: 12 })
  const sword = item({ name: 'iron_sword', type: 4, slot: 36 })
  bot.inventory = Object.assign(new EventEmitter(), {
    slots: Array(46).fill(null),
    items: () => [apple, steak, rotten],
  })
  bot.inventory.slots[36] = sword
  bot._client = new EventEmitter()
  bot.entity = { id: 7 }
  bot.registry = {
    foodsByName: {
      apple: { foodPoints: 4 },
      cooked_beef: { foodPoints: 8 },
      rotten_flesh: { foodPoints: 20 },
    },
  }
  bot.supportFeature = () => false
  bot.getEquipmentDestSlot = (hand: string) => (hand === 'hand' ? 36 : 45)
  bot.equip = async (equipped: Item) => {
    bot.inventory.slots[36] = equipped
  }
  bot.deactivateItem = () => {}
  bot.activateItem = () => {}
  return { bot, apple, steak, sword }
}

test('auto-eat selects allowed food, restores the held item, and cleans listeners', async () => {
  const { bot, steak, sword } = eatingBot()
  const eat = new EatUtil(asBot(bot))
  const events: string[] = []
  eat.on('eatStart', (opts) => events.push(String((opts.food as Item).name)))
  const pending = eat.eat()
  await nextTurn()
  assert.equal(bot.inventory.slots[36], steak)
  bot._client.emit('entity_status', { entityId: 99, entityStatus: 9 })
  assert.equal(eat.isEating, true)
  bot._client.emit('entity_status', { entityId: 7, entityStatus: 9 })
  await pending
  assert.deepEqual(events, ['cooked_beef'])
  assert.equal(bot.inventory.slots[36], sword)
  assert.equal(eat.isEating, false)
  assert.equal(bot._client.listenerCount('entity_status'), 0)
  assert.equal(bot.inventory.listenerCount('updateSlot'), 0)
})

test('auto-eat cancellation rejects, restores the item, and disables cleanly', async () => {
  const { bot, sword } = eatingBot()
  const eat = new EatUtil(asBot(bot))
  eat.enableAuto()
  eat.enableAuto()
  assert.equal(bot.listenerCount('physicsTick'), 1)
  const pending = eat.eat()
  const rejection = assert.rejects(pending, /Eating manually canceled/)
  await nextTurn()
  eat.cancelEat()
  await rejection
  assert.equal(bot.inventory.slots[36], sword)
  assert.equal(eat.isEating, false)
  assert.equal(bot._client.listenerCount('entity_status'), 0)
  assert.equal(bot.inventory.listenerCount('updateSlot'), 0)
  eat.disableAuto()
  assert.equal(bot.listenerCount('physicsTick'), 0)
})

test('auto-eat catches completion during activation and releases item use', async () => {
  const { bot } = eatingBot()
  let using = false
  bot.deactivateItem = () => { using = false }
  bot.activateItem = () => {
    using = true
    bot._client.emit('entity_status', { entityId: 7, entityStatus: 9 })
  }
  const eat = new EatUtil(asBot(bot), { eatingTimeout: 50 })
  await eat.eat()
  assert.equal(using, false)
  assert.equal(eat.isEating, false)
  assert.equal(bot._client.listenerCount('entity_status'), 0)
})

test('auto-eat recovers when equipping or restoring an item never resolves', async () => {
  for (const hangOn of [1, 2]) {
    const { bot } = eatingBot()
    const originalEquip = bot.equip
    let calls = 0
    bot.equip = (equipped: Item) => (++calls === hangOn ? new Promise(() => {}) : originalEquip(equipped))
    const eat = new EatUtil(asBot(bot), { eatingTimeout: 20 })
    if (hangOn === 1) {
      await assert.rejects(eat.eat(), /Failed to equip/)
    } else {
      bot.activateItem = () => bot._client.emit('entity_status', { entityId: 7, entityStatus: 9 })
      await eat.eat()
    }
    assert.equal(eat.isEating, false)
    assert.equal((eat as unknown as { _rejectionBinding: unknown })._rejectionBinding, undefined)
    assert.equal(bot.inventory.listenerCount('updateSlot'), 0)
  }
})

test('auto-eat times out cleanly and disabling cancels an active bite', async () => {
  const { bot } = eatingBot()
  let releases = 0
  bot.deactivateItem = () => releases++
  const eat = new EatUtil(asBot(bot), { eatingTimeout: 20 })
  await assert.rejects(eat.eat(), /timed out/)
  assert.ok(releases >= 2)
  assert.equal(eat.isEating, false)
  assert.equal(bot._client.listenerCount('entity_status'), 0)
  const pending = eat.eat()
  const rejected = assert.rejects(pending, /manually canceled/)
  await nextTurn()
  eat.disableAuto()
  await rejected
  assert.equal(eat.isEating, false)
})

test('auto-eat releases its lock after selection errors and skips full hunger retries', async () => {
  const { bot } = eatingBot()
  const eat = new EatUtil(asBot(bot))
  bot.inventory.items = () => { throw new Error('Inventory unavailable') }
  await assert.rejects(eat.eat(), /Inventory unavailable/)
  assert.equal(eat.isEating, false)
  let attempts = 0
  eat.eat = async () => {
    attempts++
  }
  bot.food = 20
  bot.health = 5
  await eat.statusCheck()
  assert.equal(attempts, 0)
  bot.food = 10
  await eat.statusCheck()
  assert.equal(attempts, 0)
  ;(eat as unknown as { _retryAt: number })._retryAt = 0
  await eat.statusCheck()
  assert.equal(attempts, 1)
})

test('tool chooses the fastest harvestable item without re-equipping an equivalent tool', async () => {
  const slow = item({ name: 'wooden_pickaxe', type: 1 })
  const fast = item({ name: 'diamond_pickaxe', type: 2 })
  const inventory = { slots: Array<Item | null>(46).fill(null), items: () => [slow, fast], emptySlotCount: () => 1 }
  inventory.slots[36] = slow
  const calls: number[] = []
  const bot = fake<Bot>({
    inventory,
    entity: { effects: [] },
    getEquipmentDestSlot: () => 36,
    equip: async (equipped: Item) => {
      calls.push(equipped.type)
      inventory.slots[36] = equipped
    },
    unequip: async () => {},
  })
  const block = fake<Block>({
    canHarvest: (type: number | null) => type !== null,
    digTime: (type: number | null) => (type === 2 ? 100 : 1000),
  })
  const tool = new Tool(bot)
  await tool.equipForBlock(block, { requireHarvest: true })
  await tool.equipForBlock(block, { requireHarvest: true })
  assert.deepEqual(calls, [2])
  await assert.rejects(tool.equipForBlock(fake<Block>({ ...block, canHarvest: () => false }), { requireHarvest: true }), {
    name: 'NoItem',
  })
})

test('task queues preserve order and stop after a failed task', async () => {
  const queue = new TaskQueue()
  const calls: number[] = []
  queue.addSync(() => calls.push(1))
  queue.add((cb) =>
    setImmediate(() => {
      calls.push(2)
      cb()
    })
  )
  await new Promise<void>((resolve, reject) => queue.runAll((error) => (error ? reject(error) : resolve())))
  assert.deepEqual(calls, [1, 2])
  queue.add((cb) => cb(new Error('failed')))
  queue.addSync(() => calls.push(3))
  await assert.rejects(
    new Promise<void>((resolve, reject) => queue.runAll((error) => (error ? reject(error) : resolve()))),
    /failed/
  )
  assert.deepEqual(calls, [1, 2])
})

test('temporary listeners and asynchronous locks release correctly', async () => {
  const emitter = new EventEmitter()
  const subscriber = new TemporarySubscriber(emitter)
  let count = 0
  subscriber.subscribeTo('tick', () => count++)
  emitter.emit('tick')
  subscriber.cleanup()
  emitter.emit('tick')
  assert.equal(count, 1)
  const lock = new Lock()
  assert.equal(lock.tryAcquire(), true)
  assert.equal(lock.tryAcquire(), false)
  const pending = lock.acquire()
  lock.release()
  await pending
  assert.equal(lock.tryAcquire(), false)
  lock.release()
})

test('A* finds a path with the original movement metadata and reports unreachable goals', () => {
  const start = new Move(0, 0, 0, 3, 0)
  const movement = fake<Movements>({
    getNeighbors: (node: Move) => (node.x < 3 ? [new Move(node.x + 1, 0, 0, node.remainingBlocks, 1)] : []),
  })
  const search = new AStar(start, movement, new goals.GoalBlock(3, 0, 0), 5000)
  const result = search.compute()
  assert.equal(result.status, 'success')
  assert.equal(result.cost, 3)
  assert.deepEqual(
    result.path.map((node) => node.x),
    [1, 2, 3]
  )
  assert.equal(result.path[0].remainingBlocks, 3)
  assert.equal(new AStar(start, movement, new goals.GoalBlock(9, 0, 0), 5000).compute().status, 'noPath')
})

test('composite, inverted and block-break goals evaluate the supplied position', () => {
  const one = new goals.GoalBlock(1, 0, 0)
  const two = new goals.GoalBlock(2, 0, 0)
  assert.equal(new goals.GoalCompositeAny([one, two]).isEnd(new Vec3(2, 0, 0)), true)
  assert.equal(new goals.GoalCompositeAll([one, two]).isEnd(new Vec3(2, 0, 0)), false)
  assert.equal(new goals.GoalInvert(one).isEnd(new Vec3(2, 0, 0)), true)
  const world = fake<LookWorld>({ raycast: () => ({ position: new Vec3(0, 0, 0) }) })
  assert.equal(new goals.GoalBreakBlock(0, 0, 0, world).isEnd(new Vec3(1, 0, 0)), true)
})

test('goto resolves on the target event and removes all temporary listeners', async () => {
  const bot = fakeBot()
  const goal = new goals.GoalBlock(1, 0, 0)
  bot.pathfinder = { setGoal: (target: unknown) => assert.equal(target, goal) }
  const pending = goto(asBot(bot), goal)
  bot.emit('goal_reached', goal)
  await pending
  for (const event of ['path_stop', 'goal_reached', 'path_update', 'goal_updated']) {
    assert.equal(bot.listenerCount(event), 0)
  }
})

test('pathfinder initializes with real registry data and plans through a loaded world', () => {
  const registry = loadRegistry('1.21.1')
  const BlockClass = loadBlock(registry)
  const bot = fakeBot()
  bot.registry = registry
  bot.entity = { position: new Vec3(0.5, 1, 0.5), velocity: new Vec3(0, 0, 0), effects: [], onGround: true }
  bot.entities = {}
  bot.inventory = { items: () => [] }
  bot.blockAt = (pos: Vec3) => {
    if (Math.abs(pos.x) > 5 || Math.abs(pos.z) > 5 || pos.y < 0) return null
    const definition = pos.y === 0 ? registry.blocksByName.stone : registry.blocksByName.air
    const block = BlockClass.fromStateId(definition.minStateId, 0)
    block.position = pos.floored()
    return block
  }
  pathfinder(asBot(bot))
  const result = bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalBlock(3, 1, 0))
  assert.equal(result.status, 'success')
  assert.equal(result.path.at(-1).x, 3.5)
  assert.equal(result.path.at(-1).y, 1)
  const unloaded = bot.pathfinder.movements.getBlock(new Vec3(100, 0, 0), 0, 0, 0)
  assert.equal(unloaded.safe, false)
  assert.equal(bot.pathfinder.movements.safeToBreak(unloaded), false)
})
