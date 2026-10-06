import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { MotionEntity } from '../src/types'
import { mob } from './fakes'
import { loadModule } from './loadModule'

// A canvas that records what the nametag draws.
const texts: string[] = []
const fills: number[][] = []
const context = {
  font: '',
  measureText: (text: string) => ({ width: text.length * 10 }),
  scale() {},
  fillText: (text: string) => texts.push(text),
  fillRect: (...args: number[]) => fills.push(args),
  strokeRect() {},
}
const canvas = { width: 0, height: 0, getContext: () => context }
const nametags = loadModule<typeof import('../src/components/watcher/playerNametag')>(
  'src/components/watcher/playerNametag.ts',
  {},
  { document: { createElement: () => canvas } }
)
const { createPlayerNametag, playerHealthText } = nametags
const entity = mob({ name: 'Steve', health: 20, kind: 'player', crouching: false })
test('health labels preserve real health and mark unavailable health explicitly', () => {
  assert.equal(playerHealthText(20), '20')
  assert.equal(playerHealthText(8.56), '8.6')
  assert.equal(playerHealthText(-2), '0')
  assert.equal(playerHealthText(), '?')
  assert.equal(playerHealthText(NaN), '?')
})
test('nametag updates health and posture without redrawing unchanged data or intercepting clicks', () => {
  texts.length = 0
  const tag = createPlayerNametag(entity)
  assert.deepEqual(texts, ['Steve', '20'])
  tag.update({ ...entity })
  assert.equal(texts.length, 2)
  tag.update({ ...entity, health: 10, crouching: true })
  assert.deepEqual(texts.slice(-2), ['Steve', '10'])
  assert.equal(tag.sprite.position.y, 2.05)
  const hits: THREE.Intersection[] = []
  tag.sprite.raycast(new THREE.Raycaster(), hits)
  assert.deepEqual(hits, [])
  tag.update({ ...entity, dead: true })
  assert.equal(tag.sprite.visible, false)
  tag.sprite.material.map?.dispose()
  tag.sprite.material.dispose()
})
test('nametags stay at a small world size and draw a pixel heart', () => {
  fills.length = 0
  const tag = createPlayerNametag(entity)
  assert.ok(fills.some((rect) => rect[2] === 2 && rect[3] === 2))
  const scene = new THREE.Scene()
  scene.add(tag.sprite)
  assert.equal(tag.sprite.scale.y, 0.3)
  const map = tag.sprite.material.map!
  const version = map.version
  tag.setHovered(true)
  assert.ok(map.version > version)
  const hoveredVersion = map.version
  tag.setHovered(true)
  assert.equal(map.version, hoveredVersion)
  map.dispose()
  tag.sprite.material.dispose()
})

test('the bot has no nametag while other players do', () => {
  const tracked = loadModule<typeof import('../src/components/watcher/entityObjects')>(
    'src/components/watcher/entityObjects.ts',
    {
      './playerNametag': nametags,
      '../../utils/entity/appearance': {
        buildEntityModel: () => null,
        lookOf: (entity: MotionEntity) => entity.name,
      },
      '../../utils/entity/animation': {},
      '../../utils/entity/itemMesh': {},
      './sceneUtils': {},
    }
  )
  const player = tracked.createTracked(entity, new THREE.Vector3(), undefined)
  const bot = tracked.createTracked(entity, new THREE.Vector3(), undefined, { bot: true })
  assert.ok(player.nametag)
  assert.equal(bot.nametag, null)
  for (const entry of [player, bot]) {
    entry.object.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
        object.material.map?.dispose()
        object.material.dispose()
      }
    })
  }
})
