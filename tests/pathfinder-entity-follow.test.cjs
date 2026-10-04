const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { PathfinderController } = require('../src/bot/plugins/pathfinder')

function setup() {
  const controller = new PathfinderController()
  controller.options = { followEnabled: true, followTarget: 'Zombie' }
  controller.movements = {}
  const pathfinder = {
    goal: null,
    setMovements() {},
    stop() {},
    setGoal(goal, dynamic) {
      this.goal = goal
      this.dynamic = dynamic
    },
  }
  controller.bot = { pathfinder, players: {}, entity: { velocity: new Vec3(0, 0, 0) } }
  controller._startFollowing = () => controller._applyFollowGoal()
  return { controller, pathfinder }
}

test('follows a selected mob dynamically without a player-list entry', () => {
  const { controller, pathfinder } = setup()
  const mob = { id: 10, isValid: true, position: new Vec3(3, 0, 0) }
  controller.followEntity(mob)
  assert.equal(pathfinder.goal.entity, mob)
  assert.equal(pathfinder.dynamic, true)
  mob.position.x = 12
  assert.equal(pathfinder.goal.entity.position.x, 12)
  controller.setOptions({ followEnabled: false })
  assert.equal(controller.followedEntity, null)
  assert.equal(pathfinder.goal, null)
})

test('a despawned entity clears its follow goal', () => {
  const { controller, pathfinder } = setup()
  const mob = { id: 10, isValid: true, position: new Vec3(3, 0, 0) }
  controller.followEntity(mob)
  mob.isValid = false
  controller._applyFollowGoal()
  assert.equal(pathfinder.goal, null)
})

test('changing the follow username replaces the selected mob with that player', () => {
  const { controller, pathfinder } = setup()
  const mob = { id: 10, isValid: true, position: new Vec3(3, 0, 0) }
  const player = { id: 11, isValid: true, position: new Vec3(5, 0, 0) }
  controller.bot.players.Alex = { entity: player }
  controller.followEntity(mob)
  controller.setOptions({ followTarget: 'Alex' })
  assert.equal(controller.followedEntity, null)
  assert.equal(pathfinder.goal.entity, player)
})
