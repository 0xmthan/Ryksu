class BehaviorManager {
  constructor({ pathfinder, pvp }) {
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

  setPathfinderOptions(options = {}) {
    const next = { ...this.state.pathfinder }
    let goToLocation = null
    const cancelGoTo = options.cancelGoTo === true

    if (typeof options.followEnabled === 'boolean') {
      next.followEnabled = options.followEnabled
    }

    if (typeof options.followTarget === 'string') {
      next.followTarget = options.followTarget.trim()
    }

    if (options.goToLocation && typeof options.goToLocation === 'object') {
      const { x, y, z } = options.goToLocation
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

  setPvpOptions(options = {}) {
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

  _apply(extra = {}) {
    if (this.pathfinder) {
      const mergedOptions = { ...this.state.pathfinder }
      if (extra.goToLocation) {
        mergedOptions.goToLocation = extra.goToLocation
      }
      if (extra.cancelGoTo) {
        mergedOptions.cancelGoTo = true
      }
      if (typeof this.pathfinder.setBlockBreakingAllowed === 'function') {
        this.pathfinder.setBlockBreakingAllowed(this.state.pvp.allowBlockBreak)
      }
      this.pathfinder.setOptions(mergedOptions)
    }

    if (this.pvp) {
      const allowMovement = !this.state.pathfinder.followEnabled && this.state.pvp.mobMovementEnabled
      this.pvp.setMovementAllowed(allowMovement)
      this.pvp.setOptions({ ...this.state.pvp, movementAllowed: allowMovement })
    }
  }
}

module.exports = { BehaviorManager }
