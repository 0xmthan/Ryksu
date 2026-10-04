const { EventEmitter } = require('node:events')
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const { SUPPORTED_VERSIONS } = require('./bot/versions')
const { kickReasonToText, normaliseError } = require('./bot/errors')
const { ChatBridge } = require('./bot/chatBridge')
const { attachPreJoinLogin } = require('./bot/preJoinLogin')
const { ArmorManagerController } = require('./bot/plugins/armorManager')
const { AutoEatController } = require('./bot/plugins/autoEat')
const { AutoToolController } = require('./bot/plugins/autoTool')
const { AutoShieldController } = require('./bot/plugins/autoShield')
const { PathfinderController } = require('./bot/plugins/pathfinder')
const { PvpController } = require('./bot/plugins/pvp')
const { BehaviorManager } = require('./bot/plugins/behaviorManager')
const { AutoSleep } = require('./bot/plugins/autoSleep')
const { BedController } = require('./bot/plugins/bed')
const { GestureController } = require('./bot/plugins/gestures')
const { CreeperWatch } = require('./bot/plugins/creeperWatch')
const { MiningController } = require('./bot/plugins/mining')
const { ManualMovementController } = require('./bot/plugins/manualMovement')
const { getWorldView } = require('./bot/worldView')
const { getMotion } = require('./bot/entityView')
const { attachEntityTracking } = require('./bot/entityEvents')
const { runInventoryAction } = require('./bot/inventoryActions')

const WORLD_INTERVAL_MS = 500
const MOTION_INTERVAL_MS = 100
const MICROSOFT_LINK_URL = 'https://www.microsoft.com/link'
const PLUGIN_PACKET_WARNING = 'The server or one of its plugins sent a packet Ryksu could not parse.'

const PHYSICS_HALF_WIDTH = 0.300001

const isIgnorablePluginPacketError = (error) => {
  const message = typeof error?.message === 'string' ? error.message : typeof error === 'string' ? error : ''
  return (
    message.includes('Chunk size is') && message.includes('partial packet') && message.includes('player_info')
  )
}

class BotManager extends EventEmitter {
  constructor() {
    super()
    this.bot = null
    this.stateInterval = null
    this.worldInterval = null
    this.motionInterval = null
    this._lastBlocksKey = null
    this._lastInvSummary = null
    this.chat = new ChatBridge(this)
    this.armorManager = new ArmorManagerController()
    this.autoEat = new AutoEatController()
    this.autoTool = new AutoToolController()
    this.autoShield = new AutoShieldController({ isManuallyControlled: () => this.manualMovement.isActive() })
    this.pathfinder = new PathfinderController()
    this.manualMovement = new ManualMovementController({
      onStart: () => {
        this._cancelDoorOperation()
        this.mining.stop('Stopped for manual movement.')
        this.pvp.stopAttacking()
        this.pvp._clearTarget()
        const options = this.behavior.setPathfinderOptions({ followEnabled: false, cancelGoTo: true })
        this.emit('pathfinderOptions', options)
      },
    })
    this.creeperWatch = new CreeperWatch({
      isManuallyControlled: () => this.manualMovement.isActive(),
      pathfinder: this.pathfinder,
      onAlert: (message) => this.chat.pushSystemMessage(message),
    })
    this.pvp = new PvpController({
      autoTool: this.autoTool,
      autoShield: this.autoShield,
      isFleeing: () => this.creeperWatch.isFleeing() || this.manualMovement.isActive(),
      onDefend: (mob) =>
        this.chat.pushSystemMessage(`Attacked by ${mob.displayName ?? mob.name ?? 'a mob'}, fighting back.`),
    })
    this.behavior = new BehaviorManager({ pathfinder: this.pathfinder, pvp: this.pvp })
    this.bed = new BedController({
      pathfinder: this.pathfinder,
      isFollowing: () => this.behavior.getPathfinderOptions().followEnabled,
    })
    this.autoSleep = new AutoSleep({
      bed: this.bed,
      isBusy: () =>
        this.manualMovement.isActive() ||
        this.behavior.getPathfinderOptions().followEnabled ||
        this.mining.getState().active ||
        this.creeperWatch.isFleeing() ||
        Boolean(this.pvp.target),
      onMessage: (text) => this.chat.pushSystemMessage(text),
    })
    this.mining = new MiningController({
      pathfinder: this.pathfinder,
      autoTool: this.autoTool,
      isBusy: () => this.creeperWatch.isFleeing() || Boolean(this.pvp.target),
      onStop: (reason) => this.chat.pushSystemMessage(`Mining stopped: ${reason}`),
      onUpdate: () => this._emitState(),
    })
    this.gestures = new GestureController({
      getTargetName: () => this.behavior.getPathfinderOptions().followTarget,
      onToggleFollow: () => this._toggleFollowFromGesture(),
    })
    this.doorOperation = null
  }

  getSupportedVersions() {
    return SUPPORTED_VERSIONS
  }

  async connect(options) {
    await this.disconnect()

    const {
      host,
      port,
      username,
      accountType,
      password,
      version,
      offlinePassword,
      preJoinLoginEnabled = false,
      armorManagerEnabled = false,
      autoEatEnabled = false,
      autoEatOptions = null,
      autoToolEnabled = false,
      autoShieldEnabled = false,
      pathfinder = { followEnabled: false, followTarget: '' },
      pvp = { mobEnabled: false, playerEnabled: false, playerTarget: '' },
    } = options

    const shouldAutoDetectVersion = !version || version === 'auto'
    const selectedVersion = shouldAutoDetectVersion ? null : version

    if (selectedVersion && !SUPPORTED_VERSIONS.includes(selectedVersion)) {
      throw new Error(`Unsupported client version "${selectedVersion}". Select one from the list.`)
    }

    const botOptions = {
      host,
      port: port ? Number(port) : undefined,
      username,
      auth: accountType === 'online' ? 'microsoft' : 'offline',
    }

    if (selectedVersion) {
      botOptions.version = selectedVersion
    }

    if (accountType === 'online' && password) {
      botOptions.password = password
    }

    if (accountType === 'online') {
      botOptions.onMsaCode = (data) => {
        const verificationUri =
          typeof data?.verification_uri === 'string' && data.verification_uri.trim()
            ? data.verification_uri.trim()
            : MICROSOFT_LINK_URL
        const userCode =
          typeof data?.user_code === 'string' && data.user_code.trim() ? data.user_code.trim() : ''
        const directVerificationUri =
          typeof data?.message === 'string' ? data.message.match(/https?:\/\/\S+/i)?.[0]?.trim() : undefined

        this.emit('status', {
          stage: 'auth-required',
          message: userCode
            ? `Microsoft sign-in required. Open the link and enter code ${userCode}.`
            : 'Microsoft sign-in required.',
          microsoftAuth: {
            verificationUri,
            directVerificationUri,
            userCode,
          },
        })
      }
    }

    this.chat.prepareForConnection(accountType === 'offline' ? offlinePassword : null, username)
    this.armorManager.setEnabled(Boolean(armorManagerEnabled))
    this.autoEat.setOptions(autoEatOptions || {})
    this.autoEat.setEnabled(Boolean(autoEatEnabled))
    this.autoTool.setEnabled(Boolean(autoToolEnabled))
    this.autoShield.setEnabled(Boolean(autoShieldEnabled))
    this.behavior.setPathfinderOptions(pathfinder)
    this.behavior.setPvpOptions(pvp)

    const connectingMessage = selectedVersion
      ? `Connecting with Minecraft ${selectedVersion}…`
      : 'Connecting to server with automatic version detection…'
    this.emit('status', { stage: 'connecting', message: connectingMessage })

    return new Promise((resolve, reject) => {
      let settled = false
      let pluginPacketWarningShown = false
      let detachPreJoinLogin = null

      const cleanup = (removePersistentHandlers = true) => {
        if (this.bot) {
          this.bot.removeListener('login', handleLogin)
          detachPreJoinLogin?.()
          detachPreJoinLogin = null
          if (removePersistentHandlers) {
            this.bot.removeListener('spawn', handleSpawn)
            this.bot.removeListener('health', handleHealth)
            this.bot.removeListener('move', handleMove)
            this.bot.removeListener('kicked', handleKicked)
            this.bot.removeListener('error', handleError)
            this.bot.removeListener('end', handleEnd)
            this.chat.detach(this.bot)
            this.armorManager.detach()
            this.autoEat.detach()
            this.autoTool.detach()
            this.autoShield.detach()
            this.pathfinder.detach()
            this.pvp.detach()
            this.bed.detach()
            this.autoSleep.detach()
            this.gestures.detach()
            this.creeperWatch.detach()
            this.mining.detach()
          }
        }
      }

      const resolveOnce = () => {
        if (!settled) {
          settled = true
          cleanup(false)
          resolve()
        }
      }

      const rejectOnce = (error, { emitStatus = true, stage = 'error' } = {}) => {
        if (settled) {
          return
        }

        console.error('[BotManager] rejectOnce input:', error)
        settled = true
        cleanup()

        const friendlyError = normaliseError(error, botOptions)
        if (emitStatus) {
          this.emit('status', { stage, message: friendlyError.message })
        }
        reject(friendlyError)
      }

      try {
        this.bot = mineflayer.createBot(botOptions)
      } catch (err) {
        rejectOnce(err)
        return
      }

      // prismarine-physics stops the bot exactly flush against block faces. Paper treats a flush hitbox as
      // colliding and pulls the bot back, so it can't jump up 1-block steps. A hair wider collision box
      // keeps it just off the face (the server still sees a normal 0.6 wide player).
      this.bot.once('login', () => {
        if (this.bot?.physics) {
          this.bot.physics.playerHalfWidth = PHYSICS_HALF_WIDTH
        }
      })

      if (accountType === 'offline' && preJoinLoginEnabled) {
        detachPreJoinLogin = attachPreJoinLogin(this.bot._client, offlinePassword, (message) =>
          this.emit('status', { stage: 'connecting', message })
        )
      }

      attachEntityTracking(this.bot)
      this.armorManager.attach(this.bot)
      this.autoEat.attach(this.bot)
      this.autoTool.attach(this.bot)
      this.autoShield.attach(this.bot)
      this.pathfinder.attach(this.bot)
      this.pvp.attach(this.bot)
      this.bed.attach(this.bot)
      this.autoSleep.attach(this.bot)
      this.gestures.attach(this.bot)
      this.creeperWatch.attach(this.bot)
      this.mining.attach(this.bot)
      this.manualMovement.attach(this.bot)
      this.behavior.applyCurrentState()

      const markWorldDirty = () => {
        if (this.bot) this.bot._worldDirty = true
      }
      this.bot.on('blockUpdate', markWorldDirty)
      this.bot.on('chunkColumnLoad', markWorldDirty)
      this.bot.on('chunkColumnUnload', markWorldDirty)

      const handleLogin = () => {
        this.emit('status', { stage: 'connected', message: 'Bot connected successfully.' })
        this._startStateStream()
        resolveOnce()
        this.chat.attach(this.bot)
      }

      const handleSpawn = () => {
        this._emitState()
      }

      const handleHealth = () => this._emitState()
      const handleMove = () => this._emitState()

      const handleKicked = (reason, loggedIn) => {
        const text = kickReasonToText(reason, this.bot?.registry)
        const friendlyError = { message: text ? `Kicked: ${text}` : 'Kicked by the server.' }
        this.emit('status', { stage: 'kicked', message: friendlyError.message })
        if (!loggedIn) {
          rejectOnce(friendlyError, { emitStatus: false })
        }
      }

      const handleError = (error) => {
        if (settled && isIgnorablePluginPacketError(error)) {
          if (!pluginPacketWarningShown) {
            pluginPacketWarningShown = true
            this.emit('status', { stage: 'warning', message: PLUGIN_PACKET_WARNING })
            this.chat.pushSystemMessage(PLUGIN_PACKET_WARNING)
          }
          return
        }

        console.error('[BotManager] Raw bot error:', error)
        rejectOnce(error)
      }

      const handleEnd = () => {
        console.error('[BotManager] Bot end event:', this.bot?._client?._endReason ?? 'socketClosed')
        this.emit('status', { stage: 'disconnected', message: 'Bot disconnected.' })
        this._stopStateStream()
        if (this.bot) {
          this.chat.detach(this.bot)
          this.armorManager.detach()
          this.autoEat.detach()
          this.autoTool.detach()
          this.autoShield.detach()
          this.pathfinder.detach()
          this.pvp.detach()
          this.bed.detach()
          this.autoSleep.detach()
          this.gestures.detach()
          this.creeperWatch.detach()
          this.mining.detach()
        }
        this.bot = null
        if (!settled) {
          rejectOnce({ message: 'Connection ended before login.' }, { emitStatus: false })
        }
      }

      this.bot.once('login', handleLogin)
      this.bot.on('spawn', handleSpawn)
      this.bot.on('health', handleHealth)
      this.bot.on('move', handleMove)
      this.bot.on('kicked', handleKicked)
      this.bot.on('error', handleError)
      this.bot.on('end', handleEnd)
    })
  }

  async disconnect() {
    this.manualMovement.detach()
    this._cancelDoorOperation()
    this._stopStateStream()

    if (!this.bot) {
      return
    }

    try {
      this.bot.quit('User requested disconnect')
    } catch {
      // Ignore errors from quitting a bot that is already shutting down.
    }

    this.chat.detach(this.bot)
    this.armorManager.detach()
    this.autoEat.detach()
    this.autoTool.detach()
    this.autoShield.detach()
    this.pathfinder.detach()
    this.pvp.detach()
    this.bed.detach()
    this.autoSleep.detach()
    this.gestures.detach()
    this.creeperWatch.detach()
    this.mining.detach()
    this.bot.removeAllListeners()
    this.bot = null
    this._lastBlocksKey = null
    this._lastInvSummary = null
    this.emit('status', { stage: 'disconnected', message: 'Bot disconnected.' })
    this.chat.clear()
  }

  getSnapshot() {
    if (!this.bot) {
      return null
    }

    const { entity } = this.bot
    const health = Number.isFinite(this.bot.health) ? this.bot.health : 0
    const food = Number.isFinite(this.bot.food) ? this.bot.food : 0
    const saturation = Number.isFinite(this.bot.foodSaturation) ? this.bot.foodSaturation : 0
    const position = entity?.position

    const experience = this.bot.experience ?? {}
    const xpLevel = Number.isFinite(experience.level) ? experience.level : 0
    const xpPoints = Number.isFinite(experience.points) ? experience.points : 0
    const xpProgress = Number.isFinite(experience.progress) ? experience.progress : 0

    const pingRaw = this.bot.player?.ping
    const ping = Number.isFinite(pingRaw) ? pingRaw : null

    return {
      connected: true,
      ...this.bed.getState(),
      mining: this.mining.getState(),
      health,
      food,
      saturation,
      position: position
        ? {
            x: Number(position.x.toFixed(2)),
            y: Number(position.y.toFixed(2)),
            z: Number(position.z.toFixed(2)),
          }
        : null,
      xp: {
        level: xpLevel,
        points: xpPoints,
        progress: xpProgress,
      },
      ping,
    }
  }

  _startStateStream() {
    if (this.stateInterval) {
      clearInterval(this.stateInterval)
    }

    this.stateInterval = setInterval(() => {
      this._emitState()
    }, 1000)
    clearInterval(this.worldInterval)
    this.worldInterval = setInterval(() => this._emitWorld(), WORLD_INTERVAL_MS)
    clearInterval(this.motionInterval)
    this.motionInterval = setInterval(() => {
      const motion = getMotion(this.bot)
      if (motion) {
        this.emit('motion', motion)
      }
    }, MOTION_INTERVAL_MS)
  }

  _stopStateStream() {
    if (this.stateInterval) {
      clearInterval(this.stateInterval)
      this.stateInterval = null
    }
    clearInterval(this.worldInterval)
    this.worldInterval = null
    clearInterval(this.motionInterval)
    this.motionInterval = null
  }

  _emitState() {
    const snapshot = this.getSnapshot()
    if (!snapshot) {
      return
    }

    this.emit('state', snapshot)
  }

  // Inventory and blocks are heavier than positions, so they go out less often.
  _emitWorld() {
    try {
      const view = getWorldView(this.bot)
      if (view) {
        const blocksKey = view.blocks?.key
        const inv = view.inventory
        const invSummary = inv
          ? `${inv.selectedHotbar}:${inv.freeSlots}:${inv.hotbar?.map((i) => (i ? `${i.name}:${i.count}` : '')).join(',')}`
          : ''
        if (blocksKey !== this._lastBlocksKey || invSummary !== this._lastInvSummary) {
          this._lastBlocksKey = blocksKey
          this._lastInvSummary = invSummary
          this.emit('world', view)
        }
      }
    } catch (error) {
      console.error('[BotManager] Failed to build world view', error)
    }
  }

  getWorldView() {
    return getWorldView(this.bot)
  }

  async inventoryAction(action) {
    await runInventoryAction(this.bot, action)
    // Show the result right away instead of waiting for the next update.
    this._emitWorld()
  }

  startMining(options) {
    if (!this.bot) {
      throw new Error('The bot is not connected.')
    }
    // Following would keep pulling the bot away from the ore.
    if (this.behavior.getPathfinderOptions().followEnabled) {
      this.emit('pathfinderOptions', this.behavior.setPathfinderOptions({ followEnabled: false }))
    }
    const state = this.mining.start(options || {})
    this.chat.pushSystemMessage(
      `Mining ${state.ores.join(', ')} and storing it in the chest at ${state.chest.x} ${state.chest.y} ${state.chest.z}.`
    )
    this._emitState()
    return state
  }

  stopMining() {
    const state = this.mining.stop()
    this._emitState()
    return state
  }

  getChatHistory() {
    return this.chat.getHistory()
  }

  async useNearestBed() {
    const result = await this.bed.useNearestBed()
    this._emitState()
    return result
  }

  async pickUpBed() {
    const result = await this.bed.pickUpPlacedBed()
    this._emitState()
    return result
  }

  _toggleFollowFromGesture() {
    const followEnabled = !this.behavior.getPathfinderOptions().followEnabled
    const options = this.behavior.setPathfinderOptions({ followEnabled })
    this.emit('pathfinderOptions', options)
    this.chat.pushSystemMessage(`Follow turned ${followEnabled ? 'on' : 'off'} by gesture.`)
  }

  dismissBedPickup() {
    this.bed.dismissPickup()
    this._emitState()
  }

  sendChat(message) {
    try {
      this.chat.send(this.bot, message)
    } catch (error) {
      throw normaliseError(error)
    }
  }

  setArmorManagerEnabled(enabled) {
    this.armorManager.setEnabled(Boolean(enabled))
    return this.armorManager.isEnabled()
  }

  setAutoEatEnabled(enabled) {
    this.autoEat.setEnabled(Boolean(enabled))
    return this.autoEat.isEnabled()
  }

  setAutoToolEnabled(enabled) {
    this.autoTool.setEnabled(Boolean(enabled))
    return this.autoTool.isEnabled()
  }

  setAutoShieldEnabled(enabled) {
    this.autoShield.setEnabled(Boolean(enabled))
    return this.autoShield.isEnabled()
  }

  setAutoEatOptions(options) {
    return this.autoEat.setOptions(options || {})
  }

  getAutoEatOptions() {
    return this.autoEat.getOptions()
  }

  setPathfinderOptions(options) {
    // Being sent somewhere calls off an attack and any existing door operation.
    if (options?.goToLocation) {
      this.pvp.stopAttacking()
      this._cancelDoorOperation()
      if (options.goToLocation.door) {
        this._scheduleDoorOpen(options.goToLocation.door)
      }
    }
    return this.behavior.setPathfinderOptions(options || {})
  }

  followEntity(entityId) {
    const entity = this.bot?.entities?.[entityId]
    if (!entity?.isValid || entity === this.bot.entity || entity.name === 'item') {
      return { ok: false, message: 'That entity is no longer available.' }
    }
    this._cancelDoorOperation()
    this.mining.stop('Stopped to follow an entity.')
    this.pvp.stopAttacking()
    const name = entity.username ?? entity.displayName ?? entity.name ?? 'entity'
    const options = this.behavior.setPathfinderOptions({
      followEnabled: true,
      followTarget: name,
      cancelGoTo: true,
    })
    this.pathfinder.followEntity(entity)
    this.emit('pathfinderOptions', options)
    return { ok: true }
  }

  // Chases and attacks one entity (picked in the watcher) until it dies or gets away.
  attackEntity(entityId) {
    this._cancelDoorOperation()
    const entity = this.bot?.entities?.[entityId]
    if (!entity || entity === this.bot.entity) {
      return { ok: false, message: 'That entity is gone.' }
    }
    if (this.behavior.getPathfinderOptions().followEnabled) {
      this.emit('pathfinderOptions', this.behavior.setPathfinderOptions({ followEnabled: false }))
    }
    this.pvp.attackEntity(entity)
    this.chat.pushSystemMessage(
      `Attacking ${entity.username ?? entity.displayName ?? entity.name ?? 'entity'}.`
    )
    return { ok: true }
  }

  _isDoorBlock(name) {
    return (
      typeof name === 'string' &&
      (name.endsWith('_door') || name === 'door' || name === 'wooden_door') &&
      !name.endsWith('trapdoor')
    )
  }

  _cancelDoorOperation() {
    if (this.doorOperation) {
      this.doorOperation.aborted = true
      if (this.doorOperation.interval) clearInterval(this.doorOperation.interval)
      if (this.doorOperation.timeout) clearTimeout(this.doorOperation.timeout)
      this.doorOperation = null
    }
  }

  // Toggles a door (opens if closed, closes if open) as soon as the bot gets within interaction reach.
  _scheduleDoorOpen(doorLocation) {
    this._cancelDoorOperation()

    const pos = new Vec3(Math.floor(doorLocation.x), Math.floor(doorLocation.y), Math.floor(doorLocation.z))
    const initialBlock = this.bot?.blockAt(pos)
    const initialProps = typeof initialBlock?.getProperties === 'function' ? initialBlock.getProperties() : {}
    const wasOpen = initialProps.open === true || initialProps.open === 'true'

    const op = { aborted: false, interval: null, timeout: null }
    this.doorOperation = op

    const cleanup = () => {
      if (op.interval) clearInterval(op.interval)
      if (op.timeout) clearTimeout(op.timeout)
      if (this.doorOperation === op) {
        this.doorOperation = null
      }
    }

    const tryToggle = async () => {
      if (op.aborted || !this.bot?.entity) {
        cleanup()
        return
      }

      const block = this.bot.blockAt(pos)
      if (!block || !this._isDoorBlock(block.name)) {
        cleanup()
        return
      }

      if (block.name.includes('iron')) {
        this.chat.pushSystemMessage('Iron doors cannot be opened by hand.')
        cleanup()
        return
      }

      const props = typeof block.getProperties === 'function' ? block.getProperties() : {}
      const currentlyOpen = props.open === true || props.open === 'true'

      // If the door already changed its state, we're done
      if (currentlyOpen !== wasOpen) {
        cleanup()
        return
      }

      const isUpper = props.half === 'upper'
      const lowerPos = isUpper ? pos.offset(0, -1, 0) : pos
      const doorCenter = lowerPos.offset(0.5, 0.5, 0.5)
      const eyePos = this.bot.entity.position.offset(0, 1.6, 0)
      const distance = eyePos.distanceTo(doorCenter)

      // Player reach is 4.5; within 3.5 blocks we can comfortably interact with the door without crowding it
      if (distance <= 3.5) {
        cleanup()
        try {
          this.bot.pathfinder?.stop()
          this.bot.pathfinder?.setGoal(null)
        } catch {}

        const doorBlock = this.bot.blockAt(lowerPos) || block
        const actionLabel = wasOpen ? 'Closed' : 'Opened'
        try {
          await this.bot.lookAt(doorCenter)
          await this.bot.activateBlock(doorBlock)
          this.chat.pushSystemMessage(`${actionLabel} ${doorBlock.displayName ?? doorBlock.name}.`)
        } catch (error) {
          console.error(`[BotManager] Failed to ${wasOpen ? 'close' : 'open'} door`, error)
        }
      }
    }

    // Try immediately in case the bot is already close to the door
    tryToggle()

    // Poll while walking towards the door
    op.interval = setInterval(tryToggle, 100)

    // Timeout after 30 seconds
    op.timeout = setTimeout(cleanup, 30000)
  }

  // Walks up to a door clicked in the watcher and opens it.
  async openDoor(location, standLocation) {
    const target = standLocation || location
    return this.setPathfinderOptions({
      followEnabled: false,
      goToLocation: {
        x: target.x,
        y: target.y,
        z: target.z,
        door: location,
      },
    })
  }

  getPathfinderOptions() {
    return this.behavior.getPathfinderOptions()
  }

  setPvpOptions(options) {
    return this.behavior.setPvpOptions(options || {})
  }

  getPvpOptions() {
    return this.behavior.getPvpOptions()
  }
}

module.exports = new BotManager()
