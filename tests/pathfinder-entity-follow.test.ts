import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import type { Entity } from 'prismarine-entity'
import { PathfinderController } from '../src/bot/plugins/pathfinder'
import type { GoalFollow } from '../src/bot/plugins/core/pathfinder/lib/goals'
import { fake, fakeBot, type FakeBot } from './fakes'

// The controller's private state, which these tests set up directly instead of loading the real plugin.
type Internals = {
  options: { followEnabled: boolean; followTarget: string }
  movements: object
  bot: FakeBot
  followedEntity: Entity | null
  _startFollowing: () => void
  _applyFollowGoal: () => void
}

function setup() {
  const controller = new PathfinderController()
  const internals = controller as unknown as Internals
  internals.options = { followEnabled: true, followTarget: 'Zombie' }
  internals.movements = {}
  const pathfinder = {
    goal: null as GoalFollow | null,
    dynamic: false,
    setMovements() {},
    stop() {},
    setGoal(goal: GoalFollow | null, dynamic = false) {
      this.goal = goal
      this.dynamic = dynamic
    },
  }
  internals.bot = fakeBot({ pathfinder, players: {}, entity: { velocity: new Vec3(0, 0, 0) } })
  internals._startFollowing = () => internals._applyFollowGoal()
  return { controller, internals, pathfinder }
}

const entity = (id: number, x: number) => fake<Entity>({ id, isValid: true, position: new Vec3(x, 0, 0) })

test('follows a selected mob dynamically without a player-list entry', () => {
  const { controller, internals, pathfinder } = setup()
  const mob = entity(10, 3)
  controller.followEntity(mob)
  assert.equal(pathfinder.goal?.entity, mob)
  assert.equal(pathfinder.dynamic, true)
  mob.position.x = 12
  assert.equal(pathfinder.goal?.entity.position.x, 12)
  controller.setOptions({ followEnabled: false })
  assert.equal(internals.followedEntity, null)
  assert.equal(pathfinder.goal, null)
})

test('a despawned entity clears its follow goal', () => {
  const { controller, internals, pathfinder } = setup()
  const mob = entity(10, 3)
  controller.followEntity(mob)
  mob.isValid = false
  internals._applyFollowGoal()
  assert.equal(pathfinder.goal, null)
})

test('changing the follow username replaces the selected mob with that player', () => {
  const { controller, internals, pathfinder } = setup()
  const mob = entity(10, 3)
  const player = entity(11, 5)
  internals.bot.players.Alex = { entity: player }
  controller.followEntity(mob)
  controller.setOptions({ followTarget: 'Alex' })
  assert.equal(internals.followedEntity, null)
  assert.equal(pathfinder.goal?.entity, player)
})
