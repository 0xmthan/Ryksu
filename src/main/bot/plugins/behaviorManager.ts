import type { PathfinderOptions, PvpOptions } from '../../../shared/types'
import type { PathfinderController } from './pathfinder'
import type { PvpController } from './pvp'

type GoToLocation = NonNullable<PathfinderOptions['goToLocation']>
type FollowOptions = Pick<PathfinderOptions, 'followEnabled' | 'followTarget'>

// Options from the renderer, checked field by field before use.
type PathfinderInput = Partial<Record<keyof PathfinderOptions, unknown>>
type PvpInput = Partial<Record<keyof PvpOptions, unknown>>

export class BehaviorManager {
  private pathfinder: PathfinderController
  private pvp: PvpController
  private state: { pathfinder: FollowOptions; pvp: PvpOptions }

  constructor({ pathfinder, pvp }: { pathfinder: PathfinderController; pvp: PvpController }) {
    this.pathfinder = pathfinder
    this.pvp = pvp
    this.state = {
      pathfinder: { followEnabled: false, followTarget: '' },
      pvp: {
        mobEnabled: false,
        playerEnabled: false,
        playerTarget: '',
        mobMovementEnabled: true,
        allowBlockBreak: true,
        jumpAttackEnabled: true,
      },
    }
  }

  applyCurrentState() {
    this._apply()
  }

  setPathfinderOptions(options: PathfinderInput = {}): FollowOptions {
    const next = { ...this.state.pathfinder }
    let goToLocation: GoToLocation | null = null
    const cancelGoTo = options.cancelGoTo === true

    if (typeof options.followEnabled === 'boolean') {
      next.followEnabled = options.followEnabled
    }

    if (typeof options.followTarget === 'string') {
      next.followTarget = options.followTarget.trim()
    }

    if (options.goToLocation && typeof options.goToLocation === 'object') {
      const { x, y, z } = options.goToLocation as Record<'x' | 'y' | 'z', unknown>
      const coordsAreNumbers = [x, y, z].every((value) => Number.isFinite(Number(value)))
      if (coordsAreNumbers) {
        goToLocation = {
          x: Number(x),
          y: Number(y),
          z: Number(z),
        }
      }
    }

    this.state.pathfinder = next
    this._apply({ goToLocation, cancelGoTo })
    return { ...this.state.pathfinder }
  }

  getPathfinderOptions() {
    return { ...this.state.pathfinder }
  }

  setPvpOptions(options: PvpInput = {}): PvpOptions {
    const next = { ...this.state.pvp }

    if (typeof options.mobEnabled === 'boolean') {
      next.mobEnabled = options.mobEnabled
    }

    if (typeof options.playerEnabled === 'boolean') {
      next.playerEnabled = options.playerEnabled
    }

    if (typeof options.playerTarget === 'string') {
      next.playerTarget = options.playerTarget.trim()
    }

    if (typeof options.mobMovementEnabled === 'boolean') {
      next.mobMovementEnabled = options.mobMovementEnabled
    }

    if (typeof options.allowBlockBreak === 'boolean') {
      next.allowBlockBreak = options.allowBlockBreak
    }

    if (typeof options.jumpAttackEnabled === 'boolean') {
      next.jumpAttackEnabled = options.jumpAttackEnabled
    }

    this.state.pvp = next
    this._apply()
    return { ...this.state.pvp }
  }

  getPvpOptions() {
    return { ...this.state.pvp }
  }

  private _apply(extra: { goToLocation?: GoToLocation | null; cancelGoTo?: boolean } = {}) {
    if (this.pathfinder) {
      const mergedOptions: PathfinderOptions = { ...this.state.pathfinder }
      if (extra.goToLocation) {
        mergedOptions.goToLocation = extra.goToLocation
      }
      if (extra.cancelGoTo) {
        mergedOptions.cancelGoTo = true
      }
      this.pathfinder.setBlockBreakingAllowed(this.state.pvp.allowBlockBreak)
      this.pathfinder.setOptions(mergedOptions)
    }

    if (this.pvp) {
      const allowMovement = !this.state.pathfinder.followEnabled && this.state.pvp.mobMovementEnabled
      this.pvp.setMovementAllowed(allowMovement)
      this.pvp.setOptions({ ...this.state.pvp, movementAllowed: allowMovement })
    }
  }
}
