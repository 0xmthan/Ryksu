class BehaviorManager {
  constructor({ pathfinder, pvp }) {
    this.pathfinder = pathfinder
    this.pvp = pvp
    this.state = {
      pathfinder: { followEnabled: false, followTarget: '' },
      pvp: { mobEnabled: false, playerEnabled: false, playerTarget: '' },
    }
  }

  applyCurrentState() {
    this._apply()
  }

  setPathfinderOptions(options = {}) {
    const next = { ...this.state.pathfinder }

    if (typeof options.followEnabled === 'boolean') {
      next.followEnabled = options.followEnabled
    }

    if (typeof options.followTarget === 'string') {
      next.followTarget = options.followTarget.trim()
    }

    this.state.pathfinder = next
    this._apply()
    return this.state.pathfinder
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

    this.state.pvp = next
    this._apply()
    return { ...this.state.pvp }
  }

  getPvpOptions() {
    return { ...this.state.pvp }
  }

  _apply() {
    if (this.pathfinder) {
      this.pathfinder.setOptions(this.state.pathfinder)
    }

    if (this.pvp) {
      const allowMovement = !this.state.pathfinder.followEnabled
      this.pvp.setMovementAllowed(allowMovement)
      this.pvp.setOptions({ ...this.state.pvp, movementAllowed: allowMovement })
    }
  }
}

module.exports = { BehaviorManager }
