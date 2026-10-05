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
const { openInteractiveBlock } = require('./bot/blockInteraction')
const { isTrader, openTrader, describeTrades, runTrade } = require('./bot/trading')
const { attachPlayerNames, playerList } = require('./bot/playerNames')
const { buildCells } = require('./bot/building')
const { skinUrl } = require('./bot/profileTextures')

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
    this.autoEat = new AutoEatController({
      onEating: (food) => {
        if (food) this.emit('notice', `Eating ${food}…`)
        this._emitState()
      },
      onResult: ({ food, ok }) => this.emit('notice', ok ? `Ate ${food}.` : `Couldn't finish eating ${food}.`),
    })
    this.effectStarts = new Map()
    // Build jobs waiting for the running one (a different kind of drag, or another block).
    this.buildQueue = []
    this.autoTool = new AutoToolController()
    this.autoShield = new AutoShieldController({
      isManuallyControlled: () => this.manualMovement.isActive() || this.openingBlock || Boolean(this.bot?.currentWindow),
      isOverridden: () => this.creeperWatch.isFleeing(),
    })
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
      isManuallyControlled: () => this.manualMovement.isActive() || this.openingBlock || Boolean(this.bot?.currentWindow),
      pathfinder: this.pathfinder,
      autoTool: this.autoTool,
      onAlert: (message) => this.chat.pushSystemMessage(message),
    })
    this.pvp = new PvpController({
      autoTool: this.autoTool,
      autoShield: this.autoShield,
      isFleeing: () => this.creeperWatch.isFleeing() || this.manualMovement.isActive() || this.openingBlock || Boolean(this.bot?.currentWindow),
      onDefend: (mob) =>
        this.chat.pushSystemMessage(`Attacked by ${mob.displayName ?? mob.name ?? 'a mob'}, fighting back.`),
    })
    // The creeper fight hits and dodges the creeper the PvP plugin is targeting.
    this.creeperWatch.pvp = this.pvp
    this.behavior = new BehaviorManager({ pathfinder: this.pathfinder, pvp: this.pvp })
    this.bed = new BedController({
      pathfinder: this.pathfinder,
      isFollowing: () => this.behavior.getPathfinderOptions().followEnabled,
    })
    this.autoSleep = new AutoSleep({
      bed: this.bed,
      isBusy: () =>
        this.manualMovement.isActive() ||
        this.openingBlock ||
        Boolean(this.bot?.currentWindow) ||
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
      onStop: (reason, { automatic }) => {
        this.chat.pushSystemMessage(`Mining stopped: ${reason}`)
        if (automatic) {
          this.emit('miningStopped', reason)
        }
      },
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
            this.bot.removeListener('entityEffect', handleEffect)
            this.bot.removeListener('entityEffectEnd', handleEffectEnd)
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
      attachPlayerNames(this.bot, `${host}:${port}`)
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
      // Effects only say how long they had left when they arrived, so note when that was.
      const handleEffect = (entity, effect) => {
        if (entity !== this.bot?.entity) return
        this.effectStarts.set(effect.id, Date.now())
        this._emitState()
      }
      const handleEffectEnd = (entity, effect) => {
        if (entity !== this.bot?.entity) return
        this.effectStarts.delete(effect.id)
        this._emitState()
      }

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
      this.bot.on('entityEffect', handleEffect)
      this.bot.on('entityEffectEnd', handleEffectEnd)
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
      ...(this.autoEat.eating ? { eating: this.autoEat.eating } : {}),
      effects: this._effects(),
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

  // The bot's status effects, for the row under health and food.
  _effects() {
    const effects = this.bot?.entity?.effects ?? {}
    return Object.values(effects).flatMap((effect) => {
      const info = this.bot.registry.effects?.[effect.id]
      if (!info) return []
      return [
        {
          // Icon name, e.g. "jump_boost".
          name: info.name.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s']/g, '_').toLowerCase(),
          label: info.displayName ?? info.name,
          level: (effect.amplifier ?? 0) + 1,
          good: info.type === 'good',
          // Ticks left when it arrived (-1: no end), and when that was.
          ticks: effect.duration,
          since: this.effectStarts.get(effect.id) ?? Date.now(),
        },
      ]
    })
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
          ? JSON.stringify(inv)
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

  async interactBlock(position) {
    if (this.openingBlock) throw new Error('Already opening a block.')
    const bot = this.bot
    if (!bot?.entity) throw new Error('The bot is not connected.')
    this.openingBlock = true
    try {
      this.manualMovement.stop()
      this._cancelDoorOperation()
      this.mining.stop('Stopped to open a block.')
      this.pvp.stopAttacking()
      this.pvp._clearTarget()
      const options = { followEnabled: false, cancelGoTo: true }
      this.pathfinder.setOptions(options)
      this.emit('pathfinderOptions', this.behavior.setPathfinderOptions(options))
      await openInteractiveBlock(bot, position)
      if (bot !== this.bot) throw new Error('The connection changed.')
      this._emitWorld()
    } finally { this.openingBlock = false }
  }

  // Build mode: breaks a line of blocks, or places the held block along one. One line at a time;
  // cancelBuild stops it after the block in progress.
  async buildAction(action) {
    const bot = this.bot
    if (!bot?.entity) throw new Error('The bot is not connected.')
    const running = this.buildRun
    if (running) {
      // The same kind (and for placing, the same block in hand) joins the line being built.
      const sameKind =
        running.type === action?.type && (action.type !== 'place' || bot.heldItem?.name === running.itemName)
      if (sameKind && Array.isArray(action.cells)) {
        running.feed.incoming.push({ cells: action.cells, face: action.face })
        return `Added ${action.cells.length} more.`
      }
      this.buildQueue.push(action)
      this._emitBuildCells()
      return `Queued ${action?.type === 'place' ? 'placing' : 'breaking'} ${action?.cells?.length ?? 0} for after this.`
    }
    return this._runBuild(action)
  }

  async _runBuild(action) {
    const bot = this.bot
    const run = {
      cancelled: false,
      stop: null,
      type: action?.type,
      itemName: bot.heldItem?.name ?? null,
      feed: { incoming: [] },
    }
    run.stopped = new Promise((resolve) => (run.stop = resolve))
    this.buildRun = run
    try {
      this.manualMovement.stop()
      this._cancelDoorOperation()
      this.mining.stop('Stopped to build.')
      this.pvp.stopAttacking()
      this.pvp._clearTarget()
      const options = { followEnabled: false, cancelGoTo: true }
      this.pathfinder.setOptions(options)
      this.emit('pathfinderOptions', this.behavior.setPathfinderOptions(options))
      return await buildCells(bot, action, {
        equipTool: this.autoTool.isEnabled(),
        onProgress: (text) => {
          if (!run.cancelled) this.emit('notice', text)
        },
        isCancelled: () => run.cancelled || bot !== this.bot,
        stopped: run.stopped,
        feed: run.feed,
        onRemaining: (cells) => {
          run.remaining = cells
          this._emitBuildCells()
        },
      })
    } finally {
      if (this.buildRun === run) this.buildRun = null
      this._emitBuildCells()
      if (bot === this.bot) this._emitWorld()
      // The next queued job starts once this one's result has gone back; its own result shows as a notice.
      const next = !run.cancelled && bot === this.bot ? this.buildQueue.shift() : null
      if (next) {
        setTimeout(() => {
          this._runBuild(next).then(
            (message) => this.emit('notice', message),
            (error) => this.emit('notice', error?.message || 'That did not work.')
          )
        }, 0)
      }
    }
  }

  // The blocks still to break and to place (the running line and queued ones), for the watcher.
  _emitBuildCells() {
    const cells = { break: [], place: [] }
    const run = this.buildRun
    if (run?.remaining && cells[run.type]) cells[run.type].push(...run.remaining)
    for (const job of this.buildQueue) {
      if (cells[job?.type] && Array.isArray(job.cells)) cells[job.type].push(...job.cells)
    }
    this.emit('buildCells', cells)
  }

  // Stops a build right away: the dig or walk in progress too, and frees the bot for the next one.
  // True if something was running.
  cancelBuild() {
    const queued = this.buildQueue.length > 0
    this.buildQueue = []
    const run = this.buildRun
    if (run) run.remaining = []
    this._emitBuildCells()
    if (!run) return queued
    run.cancelled = true
    run.stop()
    this.buildRun = null
    const bot = this.bot
    try {
      bot?.stopDigging()
    } catch {
      // Wasn't digging.
    }
    try {
      bot?.pathfinder?.setGoal(null)
    } catch {
      // Wasn't walking.
    }
    return true
  }

  // Walks to a villager or wandering trader and opens its trades.
  async openTrader(entityId) {
    if (this.openingBlock) throw new Error('Already opening something.')
    const bot = this.bot
    if (!bot?.entity) throw new Error('The bot is not connected.')
    const entity = bot.entities?.[entityId]
    if (!entity?.isValid || !isTrader(entity)) throw new Error('That is not a trader.')
    this.openingBlock = true
    try {
      this.manualMovement.stop()
      this._cancelDoorOperation()
      this.mining.stop('Stopped to trade.')
      this.pvp.stopAttacking()
      this.pvp._clearTarget()
      const options = { followEnabled: false, cancelGoTo: true }
      this.pathfinder.setOptions(options)
      this.emit('pathfinderOptions', this.behavior.setPathfinderOptions(options))
      const window = await openTrader(bot, entity)
      if (bot !== this.bot) throw new Error('The connection changed.')
      this.trader = window
      window.once('close', () => {
        if (this.trader === window) this.trader = null
      })
      this._emitWorld()
      return describeTrades(bot, window)
    } finally {
      this.openingBlock = false
    }
  }

  async trade(index, count) {
    const bot = this.bot
    const window = this.trader
    if (!bot || !window || bot.currentWindow !== window) throw new Error('The trade window is closed.')
    try {
      await runTrade(bot, window, index, count)
    } finally {
      this._emitWorld()
    }
    return describeTrades(bot, window)
  }

  closeTrader() {
    const window = this.trader
    this.trader = null
    if (window && this.bot?.currentWindow === window) this.bot.closeWindow(window)
    this._emitWorld()
  }

  getPlayerList() {
    return this.bot ? playerList(this.bot) : { online: [], offline: [] }
  }

  // The skin texture URL of a player on the server, for chat heads.
  playerSkin(name) {
    return skinUrl(this.bot?.players?.[name])
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
    const targets = this.mining._targetLabel()
    this.chat.pushSystemMessage(
      state.chests.length > 0
        ? `Mining ${targets} and storing it in ${state.chests.length === 1 ? 'the picked chest' : `${state.chests.length} picked chests`}.`
        : `Mining ${targets} until the inventory is full (no chest picked).`
    )
    this._emitState()
    return state
  }

  toggleMiningChest(position) {
    const result = this.mining.toggleChest(position)
    this._emitState()
    return result
  }

  clearMiningChests() {
    const state = this.mining.clearChests()
    this._emitState()
    return state
  }

  getMineableBlocks() {
    return this.mining.getMineableBlocks()
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

    // Also stops the polling for good: the first check can toggle before the interval below exists.
    const cleanup = () => {
      op.aborted = true
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
        this.emit('notice', 'Iron doors cannot be opened by hand.')
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
          this.emit('notice', `${actionLabel} ${doorBlock.displayName ?? doorBlock.name}.`)
        } catch (error) {
          console.error(`[BotManager] Failed to ${wasOpen ? 'close' : 'open'} door`, error)
          this.emit('notice', `Could not ${wasOpen ? 'close' : 'open'} the door.`)
        }
      }
    }

    // Poll while walking towards the door, after one try in case the bot is already close to it.
    op.interval = setInterval(tryToggle, 100)
    op.timeout = setTimeout(cleanup, 30000)
    tryToggle()
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
