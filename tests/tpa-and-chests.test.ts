import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import type { AutoToolController } from '../src/main/bot/plugins/autoTool'
import { MiningController } from '../src/main/bot/plugins/mining'
import type { ChestStore, SavedChest } from '../src/main/bot/plugins/miningChests'
import type { PathfinderController } from '../src/main/bot/plugins/pathfinder'
import { TpaAccept, tpaRequester } from '../src/main/bot/plugins/tpaAccept'
import { asBot, fake, fakeBot } from './fakes'

test('teleport requests are recognised in the usual plugin wordings', () => {
  assert.equal(tpaRequester('2mdtln wants to teleport to you. Type /tpaccept or /tpdeny.'), '2mdtln')
  assert.equal(tpaRequester('Steve has requested to teleport to you.'), 'Steve')
  assert.equal(tpaRequester('[Teleport] Alex wants you to teleport to them.'), 'Alex')
  assert.equal(tpaRequester('Bob has requested that you teleport to them.'), 'Bob')
  assert.equal(tpaRequester('<Eve> 2mdtln wants to teleport to you.'), null)
  assert.equal(tpaRequester('Teleporting...'), null)
})

function setupTpa() {
  const sent: string[] = []
  const accepted: string[] = []
  const bot = fakeBot({ username: 'Ryksu', chat: (text: string) => sent.push(text) })
  const plugin = new TpaAccept({
    isTrusted: (name) => name.toLowerCase() === '2mdtln',
    onAccept: (name) => accepted.push(name),
  })
  plugin.attach(asBot(bot))
  return { bot, plugin, sent, accepted }
}

test('a trusted player’s request is accepted once, by name', () => {
  const { bot, plugin, sent, accepted } = setupTpa()
  bot.emit('messagestr', '2mdtln wants to teleport to you.', 'system')
  bot.emit('messagestr', '2mdtln wants to teleport to you.', 'system')
  assert.deepEqual(sent, ['/tpaccept 2mdtln'])
  assert.deepEqual(accepted, ['2mdtln'])
  plugin.detach()
  assert.equal(bot.listenerCount('messagestr'), 0)
})

test('untrusted players and faked chat lines are ignored', () => {
  const { bot, sent } = setupTpa()
  bot.emit('messagestr', 'Eve wants to teleport to you.', 'system')
  bot.emit('messagestr', '2mdtln wants to teleport to you.', 'chat')
  assert.deepEqual(sent, [])
})

// A controller with an in-memory chest store and a bot whose blocks are all chests.
function setupMining(saved: Record<string, SavedChest[]> = {}) {
  const store: ChestStore = {
    load: (server) => (saved[server] ?? []).map((chest) => ({ ...chest })),
    save: (server, chests) => {
      saved[server] = chests.map((chest) => ({ ...chest }))
    },
  }
  const mining = new MiningController({
    pathfinder: fake<PathfinderController>({}),
    autoTool: fake<AutoToolController>({}),
    chestStore: store,
  })
  const bot = fakeBot({
    game: { dimension: 'minecraft:overworld' },
    blockAt: (position: Vec3) => ({ name: 'chest', position }),
  })
  mining.setServer('play.example.net:25565')
  mining.attach(asBot(bot))
  return { mining, bot, saved }
}

test('picked loot chests are saved per server and come back on the next join', () => {
  const { mining, saved } = setupMining()
  mining.toggleChest({ x: 1, y: 64, z: 2 })
  assert.deepEqual(saved['play.example.net:25565'], [{ x: 1, y: 64, z: 2, dimension: 'overworld' }])

  const again = setupMining(saved)
  assert.deepEqual(again.mining.getState().chests, [{ x: 1, y: 64, z: 2 }])
  again.mining.setServer('other.example.net:25565')
  assert.deepEqual(again.mining.getState().chests, [])
})

test('only the chests in the bot’s dimension are used', () => {
  const { mining, bot } = setupMining()
  mining.toggleChest({ x: 1, y: 64, z: 2 })
  bot.game.dimension = 'the_nether'
  assert.deepEqual(mining.getState().chests, [])
  mining.toggleChest({ x: 1, y: 64, z: 2 })
  assert.deepEqual(mining.getState().chests, [{ x: 1, y: 64, z: 2 }])
  bot.game.dimension = 'overworld'
  assert.deepEqual(mining.getState().chests, [{ x: 1, y: 64, z: 2 }])
})
