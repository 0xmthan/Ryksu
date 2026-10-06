import { EventEmitter } from 'node:events'
import mineflayer, { type Bot, type BotOptions } from 'mineflayer'
import type { Entity } from 'prismarine-entity'
import { openInteractiveBlock } from './actions/blockInteraction'
import { BreakProgress } from './world/breakProgress'
import { BuildQueue } from './actions/buildQueue'
import { ChatBridge } from './chatBridge'
import { DoorOpener } from './actions/doorOpener'
import { attachEntityTracking } from './entities/entityEvents'
import { getMotion } from './entities/entityView'
import { kickReasonToText, normaliseError, type FriendlyError } from './errors'
import { runInventoryAction } from './actions/inventoryActions'
import { attachPlayerNames, playerList } from './entities/playerNames'
import { ArmorManagerController } from './plugins/armorManager'
import { AutoEatController } from './plugins/autoEat'
import { AutoShieldController } from './plugins/autoShield'
import { AutoSleep } from './plugins/autoSleep'
import { AutoToolController } from './plugins/autoTool'
import { BedController } from './plugins/bed'
import { BehaviorManager } from './plugins/behaviorManager'
import { CreeperWatch } from './plugins/creeperWatch'
import { FirstPersonActions } from './plugins/firstPersonActions'
import { GestureController } from './plugins/gestures'
import { ManualMovementController } from './plugins/manualMovement'
import { MiningController } from './plugins/mining'
import { PathfinderController } from './plugins/pathfinder'
import { PvpController } from './plugins/pvp'
import { attachPreJoinLogin } from './preJoinLogin'
import { skinUrl } from './entities/profileTextures'
import { readVitals } from './snapshot'
import { describeTrades, isTrader, openTrader, runTrade, type TraderWindow } from './actions/trading'
import { SUPPORTED_VERSIONS } from './versions'
import { WorldStream } from './world/worldStream'
import type { ConnectOptions, SelfMotion, Vec3Like } from '../../shared/ipc'
import type {
  BotSnapshot,
  BotStatusPayload,
  BreakingState,
  BuildAction,
  BuildCells,
  ChatMessage,
  InventoryAction,
  Motion,
  PathfinderOptions,
  PvpOptions,
  WorldView,
} from '../../shared/types'
import { isPluginPacketError, PLUGIN_PACKET_WARNING } from '../../shared/protocolErrors'

type BotManagerEvents = {
  status: [status: BotStatusPayload]
  state: [snapshot: BotSnapshot]
  world: [view: WorldView]
  motion: [motion: Motion]
  selfMotion: [motion: SelfMotion]
  pathfinderOptions: [options: PathfinderOptions]
  notice: [text: string]
  breaking: [state: BreakingState]
  buildCells: [cells: BuildCells]
  chat: [entry: ChatMessage]
  miningStopped: [reason: string]
}

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

// Everything that hooks into a connected bot.
type BotPlugin = { attach(bot: Bot): void; detach(): void }

const STATE_INTERVAL_MS = 1000
const MOTION_INTERVAL_MS = 100
const MICROSOFT_LINK_URL = 'https://www.microsoft.com/link'

// prismarine-physics stops the bot exactly flush against block faces. Paper treats a flush hitbox as
// colliding and pulls the bot back, so it can't jump up 1-block steps. A hair wider collision box keeps it
// just off the face (the server still sees a normal 0.6 wide player).
const PHYSICS_HALF_WIDTH = 0.300001

const isIgnorablePluginPacketError = (error: unknown) => {
  const raw = (error as { message?: unknown } | null | undefined)?.message
  const message = typeof raw === 'string' ? raw : typeof error === 'string' ? error : ''
  return isPluginPacketError(message)
}

// The status Microsoft's device sign-in asks the user to finish (the code and where to enter it).
const microsoftAuthStatus = (raw: unknown): BotStatusPayload => {
  const data = raw as { verification_uri?: unknown; user_code?: unknown; message?: unknown } | null
  const verificationUri =
    typeof data?.verification_uri === 'string' && data.verification_uri.trim()
      ? data.verification_uri.trim()
      : MICROSOFT_LINK_URL
  const userCode = typeof data?.user_code === 'string' && data.user_code.trim() ? data.user_code.trim() : ''
  const directVerificationUri =
    typeof data?.message === 'string' ? data.message.match(/https?:\/\/\S+/i)?.[0]?.trim() : undefined
  return {
    stage: 'auth-required',
    message: userCode
      ? `Microsoft sign-in required. Open the link and enter code ${userCode}.`
      : 'Microsoft sign-in required.',
    microsoftAuth: { verificationUri, directVerificationUri, userCode },
  }
}

// One bot connection at a time and everything it does: the plugins, the streams the window watches, and the
// actions the window asks for.
export class BotManager extends EventEmitter<BotManagerEvents> {
  bot: Bot | null = null
  private stateInterval: ReturnType<typeof setInterval> | null = null
  private motionInterval: ReturnType<typeof setInterval> | null = null
  private chat = new ChatBridge(this)
  // When each of the bot's effects (by id) arrived, since effects only say how long they had left then.
  private effectStarts = new Map<number, number>()
  // Players allowed to command the bot with gestures, by lowercase name. Saved by the renderer.
  private trustedPlayers = new Set<string>()
  // Something is being opened (a block or a trader); other actions wait.
  private interaction: 'block' | 'trader' | null = null
  private trader: TraderWindow | null = null

  private armorManager: ArmorManagerController
  private autoEat: AutoEatController
  private autoTool: AutoToolController
  private autoShield: AutoShieldController
  private pathfinder: PathfinderController
  manualMovement: ManualMovementController
  private creeperWatch: CreeperWatch
  private pvp: PvpController
  private behavior: BehaviorManager
  private bed: BedController
  private autoSleep: AutoSleep
  private mining: MiningController
  private gestures: GestureController
  firstPerson: FirstPersonActions
  private breakProgress: BreakProgress
  private world: WorldStream
  private builds: BuildQueue
  private doors: DoorOpener
  // Attached to each new bot in this order, and detached together.
  private plugins: BotPlugin[]

  constructor() {
    super()
    this.armorManager = new ArmorManagerController()
    this.autoEat = new AutoEatController({
      onEating: (food) => {
        if (food) this.emit('notice', `Eating ${food}…`)
        this._emitState()
      },
      onResult: ({ food, ok }) =>
        this.emit('notice', ok ? `Ate ${food}.` : `Couldn't finish eating ${food}.`),
    })
    this.autoTool = new AutoToolController()
    this.autoShield = new AutoShieldController({
      isManuallyControlled: () => this._isUserDriving(),
      isOverridden: () => this.creeperWatch.isFleeing(),
    })
    this.pathfinder = new PathfinderController()
    this.manualMovement = new ManualMovementController({
      onStart: () => this._takeControl('Stopped for manual movement.', { stopManualMovement: false }),
    })
    this.pvp = new PvpController({
      autoTool: this.autoTool,
      autoShield: this.autoShield,
      shouldHoldOff: () => this.creeperWatch.isFleeing() || this._isUserDriving(),
      onDefend: (mob) =>
        this.chat.pushSystemMessage(`Attacked by ${mob.displayName ?? mob.name ?? 'a mob'}, fighting back.`),
    })
    // The creeper fight hits and dodges the creeper the PvP plugin is targeting.
    this.creeperWatch = new CreeperWatch({
      isManuallyControlled: () => this._isUserDriving(),
      pathfinder: this.pathfinder,
      pvp: this.pvp,
      autoTool: this.autoTool,
      onAlert: (message) => this.chat.pushSystemMessage(message),
    })
    this.behavior = new BehaviorManager({ pathfinder: this.pathfinder, pvp: this.pvp })
    this.bed = new BedController({
      pathfinder: this.pathfinder,
      isFollowing: () => this.behavior.getPathfinderOptions().followEnabled,
    })
    this.autoSleep = new AutoSleep({
      bed: this.bed,
      isBusy: () =>
        this._isUserDriving() ||
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
      isTrusted: (name) => this.isTrusted(name),
      onGesture: (entity) => this._toggleFollowFromGesture(entity),
    })
    this.firstPerson = new FirstPersonActions({ isAutoToolEnabled: () => this.autoTool.isEnabled() })
    this.breakProgress = new BreakProgress({ onChange: (state) => this.emit('breaking', state) })
    this.world = new WorldStream({ onWorld: (view) => this.emit('world', view) })
    this.builds = new BuildQueue({
      getBot: () => this.bot,
      takeControl: () => this._takeControl('Stopped to build.'),
      equipTool: () => this.autoTool.isEnabled(),
      onNotice: (text) => this.emit('notice', text),
      onCells: (cells) => this.emit('buildCells', cells),
      onDone: () => this.world.emitNow(),
    })
    this.doors = new DoorOpener({ getBot: () => this.bot, onNotice: (text) => this.emit('notice', text) })
    this.plugins = [
      this.armorManager,
      this.autoEat,
      this.autoTool,
      this.autoShield,
      this.pathfinder,
      this.pvp,
      this.bed,
      this.autoSleep,
      this.gestures,
      this.firstPerson,
      this.breakProgress,
      this.creeperWatch,
      this.mining,
      this.manualMovement,
      this.world,
    ]
  }

  getSupportedVersions() {
    return SUPPORTED_VERSIONS
  }

  async connect(options: ConnectOptions) {
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
      trustedPlayers = [],
    } = options
    this.setTrustedPlayers(trustedPlayers)

    const selectedVersion = !version || version === 'auto' ? null : version
    if (selectedVersion && !SUPPORTED_VERSIONS.includes(selectedVersion)) {
      throw new Error(`Unsupported client version "${selectedVersion}". Select one from the list.`)
    }

    const botOptions: BotOptions & { password?: string; onMsaCode?: (data: unknown) => void } = {
      host,
      port: port ? Number(port) : undefined,
      username,
      auth: accountType === 'online' ? 'microsoft' : 'offline',
    }
    if (selectedVersion) {
      botOptions.version = selectedVersion
    }
    if (accountType === 'online') {
      if (password) botOptions.password = password
      botOptions.onMsaCode = (data) => this.emit('status', microsoftAuthStatus(data))
    }

    this.chat.prepareForConnection(accountType === 'offline' ? offlinePassword : null, username)
    this.armorManager.setEnabled(Boolean(armorManagerEnabled))
    this.autoEat.setOptions(autoEatOptions || {})
    this.autoEat.setEnabled(Boolean(autoEatEnabled))
    this.autoTool.setEnabled(Boolean(autoToolEnabled))
    this.autoShield.setEnabled(Boolean(autoShieldEnabled))
    this.behavior.setPathfinderOptions(pathfinder)
    this.behavior.setPvpOptions(pvp)

    this.emit('status', {
      stage: 'connecting',
      message: selectedVersion
        ? `Connecting with Minecraft ${selectedVersion}…`
        : 'Connecting to server with automatic version detection…',
    })

    return new Promise<void>((resolve, reject) => {
      let settled = false
      let pluginPacketWarningShown = false
      let detachPreJoinLogin: (() => void) | null = null

      const cleanup = (removePersistentHandlers = true) => {
        if (!this.bot) return
        this.bot.removeListener('login', handleLogin)
        detachPreJoinLogin?.()
        detachPreJoinLogin = null
        if (removePersistentHandlers) {
          this.bot.removeListener('spawn', emitState)
          this.bot.removeListener('health', emitState)
          this.bot.removeListener('move', emitState)
          this.bot.removeListener('entityEffect', handleEffect as never)
          this.bot.removeListener('entityEffectEnd', handleEffectEnd as never)
          this.bot.removeListener('kicked', handleKicked as never)
          this.bot.removeListener('error', handleError)
          this.bot.removeListener('end', handleEnd)
          this._detachAll(this.bot)
        }
      }

      const resolveOnce = () => {
        if (!settled) {
          settled = true
          cleanup(false)
          resolve()
        }
      }

      const rejectOnce = (error: unknown, { emitStatus = true, stage = 'error' } = {}) => {
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

      let bot: Bot
      try {
        bot = this.bot = mineflayer.createBot(botOptions)
      } catch (err) {
        rejectOnce(err)
        return
      }

      bot.once('login', () => {
        const physics = (bot as Bot & { physics?: { playerHalfWidth: number } }).physics
        if (physics) {
          physics.playerHalfWidth = PHYSICS_HALF_WIDTH
        }
      })

      if (accountType === 'offline' && preJoinLoginEnabled) {
        detachPreJoinLogin = attachPreJoinLogin(bot._client, offlinePassword, (message) =>
          this.emit('status', { stage: 'connecting', message })
        )
      }

      attachEntityTracking(bot)
      attachPlayerNames(bot, `${host}:${port}`)
      for (const plugin of this.plugins) plugin.attach(bot)
      this.behavior.applyCurrentState()

      // The bot's own position every physics tick, so the watcher (first person above all) shows where it
      // really is, not where the slower motion stream last saw it.
      bot.on('physicsTick', () => {
        const { position, velocity, onGround } = bot.entity ?? {}
        if (!position) return
        this.emit('selfMotion', {
          x: position.x,
          y: position.y,
          z: position.z,
          vx: velocity?.x ?? 0,
          vy: velocity?.y ?? 0,
          vz: velocity?.z ?? 0,
          onGround: Boolean(onGround),
          sprinting: Boolean(
            bot.getControlState('sprint') && bot.getControlState('forward') && !bot.getControlState('sneak')
          ),
        })
      })

      const handleLogin = () => {
        this.emit('status', { stage: 'connected', message: 'Bot connected successfully.' })
        this._startStreams()
        resolveOnce()
        this.chat.attach(this.bot)
      }

      const emitState = () => this._emitState()

      const handleEffect = (entity: Entity, effect: { id: number }) => {
        if (entity !== this.bot?.entity) return
        this.effectStarts.set(effect.id, Date.now())
        this._emitState()
      }
      const handleEffectEnd = (entity: Entity, effect: { id: number }) => {
        if (entity !== this.bot?.entity) return
        this.effectStarts.delete(effect.id)
        this._emitState()
      }

      const handleKicked = (reason: unknown, loggedIn: boolean) => {
        const text = kickReasonToText(reason, this.bot?.registry)
        const friendlyError: FriendlyError = { message: text ? `Kicked: ${text}` : 'Kicked by the server.' }
        this.emit('status', { stage: 'kicked', message: friendlyError.message })
        if (!loggedIn) {
          rejectOnce(friendlyError, { emitStatus: false })
        }
      }

      const handleError = (error: Error) => {
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
        console.error(
          '[BotManager] Bot end event:',
          (this.bot?._client as { _endReason?: string } | undefined)?._endReason ?? 'socketClosed'
        )
        this.emit('status', { stage: 'disconnected', message: 'Bot disconnected.' })
        this._stopStreams()
        if (this.bot) this._detachAll(this.bot)
        this.bot = null
        if (!settled) {
          rejectOnce({ message: 'Connection ended before login.' }, { emitStatus: false })
        }
      }

      bot.once('login', handleLogin)
      bot.on('spawn', emitState)
      bot.on('health', emitState)
      bot.on('move', emitState)
      bot.on('entityEffect', handleEffect as never)
      bot.on('entityEffectEnd', handleEffectEnd as never)
      bot.on('kicked', handleKicked as never)
      bot.on('error', handleError)
      bot.on('end', handleEnd)
    })
  }

  async disconnect() {
    this.manualMovement.detach()
    this.doors.cancel()
    this._stopStreams()

    const bot = this.bot
    if (!bot) {
      return
    }

    try {
      bot.quit('User requested disconnect')
    } catch {
      // Ignore errors from quitting a bot that is already shutting down.
    }

    this._detachAll(bot)
    bot.removeAllListeners()
    this.bot = null
    this.emit('status', { stage: 'disconnected', message: 'Bot disconnected.' })
    this.chat.clear()
  }

  getSnapshot(): ConnectedSnapshot | null {
    const bot = this.bot
    if (!bot) {
      return null
    }
    return {
      connected: true,
      ...this.bed.getState(),
      mining: this.mining.getState(),
      ...(this.autoEat.eating ? { eating: this.autoEat.eating } : {}),
      ...readVitals(bot, this.effectStarts),
    }
  }

  getWorldView() {
    return this.world.getWorldView()
  }

  async interactBlock(position: Vec3Like) {
    if (this.interaction) throw new Error('Already opening a block.')
    const bot = this.bot
    if (!bot?.entity) throw new Error('The bot is not connected.')
    this.interaction = 'block'
    try {
      this._takeControl('Stopped to open a block.')
      await openInteractiveBlock(bot, position)
      if (bot !== this.bot) throw new Error('The connection changed.')
      this.world.emitNow()
    } finally {
      this.interaction = null
    }
  }

  // Build mode: breaks a line of blocks, or places the held block along one (see BuildQueue).
  buildAction(action: BuildAction) {
    return this.builds.add(action)
  }

  // Stops the build line in progress and any queued after it. True if there was one.
  cancelBuild() {
    return this.builds.cancel()
  }

  // Walks to a villager or wandering trader and opens its trades.
  async openTrader(entityId: number) {
    if (this.interaction) throw new Error('Already opening something.')
    const bot = this.bot
    if (!bot?.entity) throw new Error('The bot is not connected.')
    const entity = bot.entities?.[entityId]
    if (!entity?.isValid || !isTrader(entity)) throw new Error('That is not a trader.')
    this.interaction = 'trader'
    try {
      this._takeControl('Stopped to trade.')
      const window = await openTrader(bot, entity)
      if (bot !== this.bot) throw new Error('The connection changed.')
      this.trader = window
      ;(window as unknown as EventEmitter).once('close', () => {
        if (this.trader === window) this.trader = null
      })
      this.world.emitNow()
      return describeTrades(bot, window)
    } finally {
      this.interaction = null
    }
  }

  async trade(index: number, count: number) {
    const bot = this.bot
    const window = this.trader
    if (!bot || !window || bot.currentWindow !== (window as unknown))
      throw new Error('The trade window is closed.')
    try {
      await runTrade(bot, window, index, count)
    } finally {
      this.world.emitNow()
    }
    return describeTrades(bot, window)
  }

  closeTrader() {
    const window = this.trader
    this.trader = null
    const bot = this.bot
    if (window && bot && bot.currentWindow === (window as unknown)) bot.closeWindow(window as never)
    this.world.emitNow()
  }

  getPlayerList() {
    return this.bot ? playerList(this.bot) : { online: [], offline: [] }
  }

  // The skin texture URL of a player on the server, for chat heads.
  playerSkin(name: string) {
    return skinUrl(this.bot?.players?.[name])
  }

  async inventoryAction(action: InventoryAction) {
    await runInventoryAction(this.bot, action)
    // Show the result right away instead of waiting for the next update.
    this.world.emitNow()
  }

  startMining(options: { ores?: unknown; blocks?: unknown }) {
    if (!this.bot) {
      throw new Error('The bot is not connected.')
    }
    // Following would keep pulling the bot away from the ore.
    if (this.behavior.getPathfinderOptions().followEnabled) {
      this.emit('pathfinderOptions', this.behavior.setPathfinderOptions({ followEnabled: false }))
    }
    const state = this.mining.start(options || {})
    const targets = this.mining.describeTargets()
    this.chat.pushSystemMessage(
      state.chests.length > 0
        ? `Mining ${targets} and storing it in ${state.chests.length === 1 ? 'the picked chest' : `${state.chests.length} picked chests`}.`
        : `Mining ${targets} until the inventory is full (no chest picked).`
    )
    this._emitState()
    return state
  }

  toggleMiningChest(position: unknown) {
    const result = this.mining.toggleChest(position)
    this._emitState()
    return result
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

  dismissBedPickup() {
    this.bed.dismissPickup()
    this._emitState()
  }

  isTrusted(name: unknown) {
    return typeof name === 'string' && this.trustedPlayers.has(name.toLowerCase())
  }

  setTrustedPlayers(names: unknown) {
    this.trustedPlayers.clear()
    for (const name of Array.isArray(names) ? names : []) {
      if (typeof name === 'string' && name.trim()) this.trustedPlayers.add(name.trim().toLowerCase())
    }
  }

  // The 3D view's render distance (blocks out from the bot), from the app's graphics settings.
  setRenderDistance(blocks: unknown) {
    return this.world.setRenderDistance(blocks)
  }

  sendChat(message: unknown) {
    try {
      this.chat.send(this.bot, message)
    } catch (error) {
      throw normaliseError(error)
    }
  }

  setArmorManagerEnabled(enabled: unknown) {
    this.armorManager.setEnabled(Boolean(enabled))
    return this.armorManager.isEnabled()
  }

  setAutoEatEnabled(enabled: unknown) {
    this.autoEat.setEnabled(Boolean(enabled))
    return this.autoEat.isEnabled()
  }

  setAutoToolEnabled(enabled: unknown) {
    this.autoTool.setEnabled(Boolean(enabled))
    return this.autoTool.isEnabled()
  }

  setAutoShieldEnabled(enabled: unknown) {
    this.autoShield.setEnabled(Boolean(enabled))
    return this.autoShield.isEnabled()
  }

  setAutoEatOptions(options: unknown) {
    return this.autoEat.setOptions(options || {})
  }

  setPathfinderOptions(options: Partial<PathfinderOptions> | null | undefined) {
    // Being sent somewhere calls off an attack and any existing door operation.
    if (options?.goToLocation) {
      this.pvp.stopAttacking()
      this.doors.cancel()
      if (options.goToLocation.door) {
        this.doors.schedule(options.goToLocation.door)
      }
    }
    return this.behavior.setPathfinderOptions(options || {})
  }

  setPvpOptions(options: Partial<PvpOptions> | null | undefined) {
    return this.behavior.setPvpOptions(options || {})
  }

  followEntity(entityId: number) {
    const entity = this.bot?.entities?.[entityId]
    if (!entity?.isValid || entity === this.bot?.entity || entity.name === 'item') {
      return { ok: false, message: 'That entity is no longer available.' }
    }
    this.doors.cancel()
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
  attackEntity(entityId: number) {
    this.doors.cancel()
    const entity = this.bot?.entities?.[entityId]
    if (!entity || entity === this.bot?.entity) {
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

  // The user has the bot's controls (walking it, or a block or trader is being opened, or a window is open);
  // automatic behaviors stay out of the way.
  private _isUserDriving() {
    return this.manualMovement.isActive() || this.interaction !== null || Boolean(this.bot?.currentWindow)
  }

  // Frees the bot for something the user asked for: stops walking, mining, fighting and following.
  private _takeControl(miningReason: string, { stopManualMovement = true } = {}) {
    if (stopManualMovement) this.manualMovement.stop()
    this.doors.cancel()
    this.mining.stop(miningReason)
    this.pvp.stopAttacking()
    this.pvp.clearTarget()
    this.emit(
      'pathfinderOptions',
      this.behavior.setPathfinderOptions({ followEnabled: false, cancelGoTo: true })
    )
  }

  // A trusted player's gesture: follow them, or stop if the bot already is.
  private _toggleFollowFromGesture(entity: Entity) {
    const { followEnabled, followTarget } = this.behavior.getPathfinderOptions()
    if (followEnabled && followTarget.toLowerCase() === entity.username?.toLowerCase()) {
      this.emit('pathfinderOptions', this.behavior.setPathfinderOptions({ followEnabled: false }))
      return
    }
    // The watcher's status pill shows who the bot is following.
    this.followEntity(entity.id)
  }

  private _detachAll(bot: Bot) {
    this.chat.detach(bot)
    for (const plugin of this.plugins) plugin.detach()
  }

  // Snapshot and motion go out on timers (the world view has its own); state also on every change.
  private _startStreams() {
    this._stopStreams()
    this.stateInterval = setInterval(() => this._emitState(), STATE_INTERVAL_MS)
    this.motionInterval = setInterval(() => {
      const motion = getMotion(this.bot, this.trustedPlayers)
      if (motion) {
        this.emit('motion', motion)
      }
    }, MOTION_INTERVAL_MS)
    this.world.start()
  }

  private _stopStreams() {
    if (this.stateInterval) clearInterval(this.stateInterval)
    this.stateInterval = null
    if (this.motionInterval) clearInterval(this.motionInterval)
    this.motionInterval = null
    this.world.stop()
  }

  private _emitState() {
    const snapshot = this.getSnapshot()
    if (snapshot) {
      this.emit('state', snapshot)
    }
  }
}
