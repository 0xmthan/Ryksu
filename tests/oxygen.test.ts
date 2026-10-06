import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Bot } from 'mineflayer'
import { readOxygen } from '../src/bot/oxygen'
import { fake } from './fakes'

const registry = { entitiesByName: { player: { metadataKeys: ['shared_flags', 'air_supply'] } } }
const botWith = (metadata: number[], extra = {}) =>
  fake<Bot>({ registry, entity: { name: 'player', metadata }, ...extra })

test('oxygen comes from the bot, not from what mineflayer last saw on any entity', () => {
  // A nearby mob's air update leaves bot.oxygenLevel at its value; the bot's own air is full.
  assert.equal(readOxygen(botWith([0, 300], { oxygenLevel: 7 })), 20)
  assert.equal(readOxygen(botWith([0, 150])), 10)
  assert.equal(readOxygen(botWith([0, -20])), 0)
})

test('oxygen is full until the bot has air metadata', () => {
  assert.equal(readOxygen(botWith([])), 20)
  assert.equal(readOxygen(fake<Bot>({ registry, entity: null })), 20)
  // Versions without metadata names use the air slot directly.
  assert.equal(readOxygen(fake<Bot>({ entity: { name: 'player', metadata: [0, 90] } })), 6)
})
