import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import mineflayer, { type Bot, type BotOptions } from 'mineflayer'
import type { Entity } from 'prismarine-entity'
import { Vec3 } from 'vec3'
import { openInteractiveBlock } from './bot/blockInteraction'
import { BreakProgress } from './bot/breakProgress'
import { buildCells, type BuildFeed } from './bot/building'
import { ChatBridge } from './bot/chatBridge'
import { attachEntityTracking } from './bot/entityEvents'
import { getMotion } from './bot/entityView'
import { kickReasonToText, normaliseError, type FriendlyError } from './bot/errors'
import { runInventoryAction } from './bot/inventoryActions'
import { readOxygen } from './bot/oxygen'
import { attachPlayerNames, playerList } from './bot/playerNames'
import { attachPreJoinLogin } from './bot/preJoinLogin'
import { ArmorManagerController } from './bot/plugins/armorManager'
import { AutoEatController } from './bot/plugins/autoEat'
import { AutoShieldController } from './bot/plugins/autoShield'
import { AutoSleep } from './bot/plugins/autoSleep'
import { AutoToolController } from './bot/plugins/autoTool'
import { BedController } from './bot/plugins/bed'
import { BehaviorManager } from './bot/plugins/behaviorManager'
import { CreeperWatch } from './bot/plugins/creeperWatch'
import { FirstPersonActions } from './bot/plugins/firstPersonActions'
import { GestureController } from './bot/plugins/gestures'
import { ManualMovementController } from './bot/plugins/manualMovement'
import { MiningController } from './bot/plugins/mining'
import { PathfinderController } from './bot/plugins/pathfinder'
import { PvpController } from './bot/plugins/pvp'
import { skinUrl } from './bot/profileTextures'
import { describeTrades, isTrader, openTrader, runTrade, type TraderWindow } from './bot/trading'
import { SUPPORTED_VERSIONS } from './bot/versions'
import { computeBlocks, type BlocksData, type ComputeInput } from './bot/worldCompute'
import { computeInput, getWorldView, readSlice, setBlocksData } from './bot/worldView'
import type { ConnectOptions, SelfMotion, Vec3Like } from './ipc'
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
  StatusEffect,
  WorldView,
} from './types'

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

// A line of build mode work in progress (see buildAction).
type BuildRun = {
  cancelled: boolean
  stop: () => void
  stopped: Promise<void>
  type: BuildAction['type'] | undefined
  itemName: string | null
  feed: BuildFeed
  remaining?: Vec3Like[]
}

type DoorOperation = {
  aborted: boolean
  interval: ReturnType<typeof setInterval> | null
  timeout: ReturnType<typeof setTimeout> | null
}

type WorldJob = { id: number; bot: Bot }

const WORLD_INTERVAL_MS = 500
// How soon the 3D view is sent after a block changes (grouping a few together), and after chunks load.
const BLOCK_UPDATE_DELAY_MS = 16
const CHUNK_UPDATE_DELAY_MS = 150
const MOTION_INTERVAL_MS = 100
const MICROSOFT_LINK_URL = 'https://www.microsoft.com/link'
const PLUGIN_PACKET_WARNING = 'The server or one of its plugins sent a packet Ryksu could not parse.'

const PHYSICS_HALF_WIDTH = 0.300001

const isIgnorablePluginPacketError = (error: unknown) => {
  const raw = (error as { message?: unknown } | null | undefined)?.message
  const message = typeof raw === 'string' ? raw : typeof error === 'string' ? error : ''
  return (
    message.includes('Chunk size is') && message.includes('partial packet') && message.includes('player_info')
  )
}

export class BotManager extends EventEmitter<BotManagerEvents> {
  bot: Bot | null
  private stateInterval: ReturnType<typeof setInterval> | null
  private worldInterval: ReturnType<typeof setInterval> | null
  private motionInterval: ReturnType<typeof setInterval> | null
  private worldEmitTimer: ReturnType<typeof setTimeout> | null = null
  private worldEmitAt = 0
  private worldWorker: Worker | null = null
  private worldWorkerFailed = false
  private worldBusy: WorldJob | null = null
  private worldPending: { bot: Bot; input: ComputeInput } | null = null
  private worldJobId = 0
  private _lastBlocksKey: string | null | undefined
  private _lastInvSummary: string | null
  private chat: ChatBridge
  private armorManager: ArmorManagerController
  private autoEat: AutoEatController
  private effectStarts: Map<number, number>
  private buildQueue: BuildAction[]
  private buildRun: BuildRun | null = null
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
  private trustedPlayers: Set<string>
  private gestures: GestureController
  firstPerson: FirstPersonActions
  private breakProgress: BreakProgress
  private doorOperation: DoorOperation | null
  // Something is being opened (a block or a trader); other actions wait.
  private openingBlock = false
  private trader: TraderWindow | null = null
  private renderDistance: number | null = null

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
    // Players allowed to command the bot with gestures, by lowercase name. Saved by the renderer.
    this.trustedPlayers = new Set()
    this.gestures = new GestureController({
      isTrusted: (name) => this.isTrusted(name),
      onGesture: (entity) => this._toggleFollowFromGesture(entity),
    })
    this.firstPerson = new FirstPersonActions({ isAutoToolEnabled: () => this.autoTool.isEnabled() })
    this.breakProgress = new BreakProgress({ onChange: (state) => this.emit('breaking', state) })
    this.doorOperation = null
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

    const shouldAutoDetectVersion = !version || version === 'auto'
    const selectedVersion = shouldAutoDetectVersion ? null : version

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

    if (accountType === 'online' && password) {
      botOptions.password = password
    }

    if (accountType === 'online') {
      botOptions.onMsaCode = (raw) => {
        const data = raw as { verification_uri?: unknown; user_code?: unknown; message?: unknown } | null
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

    return new Promise<void>((resolve, reject) => {
      let settled = false
      let pluginPacketWarningShown = false
      let detachPreJoinLogin: (() => void) | null = null

      const cleanup = (removePersistentHandlers = true) => {
        if (this.bot) {
          this.bot.removeListener('login', handleLogin)
          detachPreJoinLogin?.()
          detachPreJoinLogin = null
          if (removePersistentHandlers) {
            this.bot.removeListener('spawn', handleSpawn)
            this.bot.removeListener('health', handleHealth)
            this.bot.removeListener('move', handleMove)
            this.bot.removeListener('entityEffect', handleEffect as never)
            this.bot.removeListener('entityEffectEnd', handleEffectEnd as never)
            this.bot.removeListener('kicked', handleKicked as never)
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
            this.firstPerson.detach()
            this.breakProgress.detach()
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
        // Read by the entity view to badge trusted players' nametags.
        bot._trustedPlayers = this.trustedPlayers
      } catch (err) {
        rejectOnce(err)
        return
      }

      // prismarine-physics stops the bot exactly flush against block faces. Paper treats a flush hitbox as
      // colliding and pulls the bot back, so it can't jump up 1-block steps. A hair wider collision box
      // keeps it just off the face (the server still sees a normal 0.6 wide player).
      bot.once('login', () => {
        const physics = (this.bot as (Bot & { physics?: { playerHalfWidth: number } }) | null)?.physics
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
      this.armorManager.attach(bot)
      this.autoEat.attach(bot)
      this.autoTool.attach(bot)
      this.autoShield.attach(bot)
      this.pathfinder.attach(bot)
      this.pvp.attach(bot)
      this.bed.attach(bot)
      this.autoSleep.attach(bot)
      this.gestures.attach(bot)
      this.firstPerson.attach(bot)
      this.breakProgress.attach(bot)
      this.creeperWatch.attach(bot)
      this.mining.attach(bot)
      this.manualMovement.attach(bot)
      this.behavior.applyCurrentState()

      // A changed block is re-read on its own and sent right away (not on the next tick), so breaking and
      // placing show up as soon as the server confirms them. Chunks coming or going re-read just their
      // columns, batched since they arrive in bursts; a respawn (maybe in another dimension) reads it all
      // again. See readSlice in src/bot/worldView.js.
      const worldChanges = (bot._worldChanges = new Set<string>())
      const worldChunks = (bot._worldChunks = new Set<string>())
      if (this.renderDistance) bot._worldRadius = this.renderDistance
      bot.on('blockUpdate', (_old, block) => {
        if (!block?.position) return
        const { x, y, z } = block.position
        worldChanges.add(`${x},${y},${z}`)
        bot._worldDirty = true
        this._scheduleWorldEmit(BLOCK_UPDATE_DELAY_MS)
      })
      const markChunkDirty = (point?: Vec3) => {
        if (point) worldChunks.add(`${Math.floor(point.x / 16)},${Math.floor(point.z / 16)}`)
        else bot._worldFullDirty = true
        bot._worldDirty = true
        this._scheduleWorldEmit(CHUNK_UPDATE_DELAY_MS)
      }
      bot.on('chunkColumnLoad', markChunkDirty)
      bot.on('chunkColumnUnload', markChunkDirty)
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
          sprinting: Boolean(bot.getControlState('sprint') && bot.getControlState('forward') && !bot.getControlState('sneak')),
        })
      })
      bot.on('respawn', () => {
        bot._worldFullDirty = true
        bot._worldDirty = true
        this._scheduleWorldEmit(CHUNK_UPDATE_DELAY_MS)
      })

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
          this.firstPerson.detach()
          this.breakProgress.detach()
          this.creeperWatch.detach()
          this.mining.detach()
        }
        this.bot = null
        if (!settled) {
          rejectOnce({ message: 'Connection ended before login.' }, { emitStatus: false })
        }
      }

      bot.once('login', handleLogin)
      bot.on('spawn', handleSpawn)
      bot.on('health', handleHealth)
      bot.on('move', handleMove)
      bot.on('entityEffect', handleEffect as never)
      bot.on('entityEffectEnd', handleEffectEnd as never)
      bot.on('kicked', handleKicked as never)
      bot.on('error', handleError)
      bot.on('end', handleEnd)
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
    this.firstPerson.detach()
    this.breakProgress.detach()
    this.creeperWatch.detach()
    this.mining.detach()
    this.bot.removeAllListeners()
    this.bot = null
    this._lastBlocksKey = null
    this._lastInvSummary = null
    this.emit('status', { stage: 'disconnected', message: 'Bot disconnected.' })
    this.chat.clear()
  }

  // Whether the bot's eyes are in water, when the game shows the air bubbles.
  private _headUnderwater(bot: Bot) {
    try {
      const eyes = bot.entity?.position?.offset(0, bot.entity.eyeHeight ?? 1.62, 0)
      const block = eyes ? bot.blockAt(eyes) : null
      if (!block) return false
      const waterlogged = block.getProperties?.().waterlogged
      return block.name === 'water' || block.name === 'bubble_column' || waterlogged === true || waterlogged === 'true'
    } catch {
      return false
    }
  }

  getSnapshot(): ConnectedSnapshot | null {
    const bot = this.bot
    if (!bot) {
      return null
    }

    const { entity } = bot
    const health = Number.isFinite(bot.health) ? bot.health : 0
    const food = Number.isFinite(bot.food) ? bot.food : 0
    const saturation = Number.isFinite(bot.foodSaturation) ? bot.foodSaturation : 0
    const position = entity?.position

    const experience: Partial<Bot['experience']> = bot.experience ?? {}
    const xpLevel = Number.isFinite(experience.level) ? experience.level! : 0
    const xpPoints = Number.isFinite(experience.points) ? experience.points! : 0
    const xpProgress = Number.isFinite(experience.progress) ? experience.progress! : 0

    const pingRaw = bot.player?.ping
    const ping = Number.isFinite(pingRaw) ? pingRaw : null
    const oxygen = readOxygen(bot)

    return {
      connected: true,
      ...this.bed.getState(),
      mining: this.mining.getState(),
      ...(this.autoEat.eating ? { eating: this.autoEat.eating } : {}),
      effects: this._effects(bot),
      health,
      food,
      saturation,
      oxygen,
      underwater: this._headUnderwater(bot),
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

  private _startStateStream() {
    if (this.stateInterval) {
      clearInterval(this.stateInterval)
    }

    this.stateInterval = setInterval(() => {
      this._emitState()
    }, 1000)
    if (this.worldInterval) clearInterval(this.worldInterval)
    this.worldInterval = setInterval(() => this._emitWorld(), WORLD_INTERVAL_MS)
    if (this.motionInterval) clearInterval(this.motionInterval)
    this.motionInterval = setInterval(() => {
      const motion = getMotion(this.bot)
      if (motion) {
        this.emit('motion', motion)
      }
    }, MOTION_INTERVAL_MS)
  }

  private _stopStateStream() {
    if (this.stateInterval) {
      clearInterval(this.stateInterval)
      this.stateInterval = null
    }
    if (this.worldInterval) clearInterval(this.worldInterval)
    this.worldInterval = null
    if (this.worldEmitTimer) clearTimeout(this.worldEmitTimer)
    this.worldEmitTimer = null
    if (this.motionInterval) clearInterval(this.motionInterval)
    this.motionInterval = null
  }

  // The bot's status effects, for the row under health and food.
  private _effects(bot: Bot): StatusEffect[] {
    const effects = bot.entity?.effects ?? {}
    return Object.values(effects).flatMap((effect) => {
      const info = bot.registry.effects?.[effect.id] as
        | { name: string; displayName?: string; type?: string }
        | undefined
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

  private _emitState() {
    const snapshot = this.getSnapshot()
    if (!snapshot) {
      return
    }

    this.emit('state', snapshot)
  }

  // Inventory and blocks are heavier than positions, so they go out less often.
  // Sends the world view after `delay` ms, unless one is already on its way sooner.
  private _scheduleWorldEmit(delay: number) {
    if (this.worldEmitTimer && this.worldEmitAt <= Date.now() + delay) return
    if (this.worldEmitTimer) clearTimeout(this.worldEmitTimer)
    this.worldEmitAt = Date.now() + delay
    this.worldEmitTimer = setTimeout(() => {
      this.worldEmitTimer = null
      this._emitWorld()
    }, delay)
  }

  // The worker that builds the 3D view's payload (src/worldWorker.js), started once. Without it (tests,
  // or if it fails to start) the payload is built right here instead.
  private _worldWorker() {
    if (this.worldWorker || this.worldWorkerFailed) return this.worldWorker ?? null
    const file = path.join(__dirname, 'worldWorker.cjs')
    try {
      if (!fs.existsSync(file)) throw new Error('not built')
      const worker = new Worker(file)
      worker.on('message', (message) => this._onWorldComputed(message))
      worker.on('error', (error) => {
        console.error('[BotManager] World worker failed; building the view on the main thread', error)
        this.worldWorkerFailed = true
        this.worldWorker = null
        this.worldBusy = null
      })
      worker.unref()
      this.worldWorker = worker
    } catch {
      this.worldWorkerFailed = true
    }
    return this.worldWorker ?? null
  }

  // One job at a time; while one runs, only the newest waiting input is kept.
  private _queueWorldCompute(bot: Bot, input: ComputeInput) {
    if (this.worldBusy) {
      this.worldPending = { bot, input }
      return
    }
    const id = (this.worldJobId = (this.worldJobId ?? 0) + 1)
    this.worldBusy = { id, bot }
    const buffers = [input.grid, input.kinds, input.leafy, input.submerged, input.occludes].map(
      (array) => array.buffer as ArrayBuffer
    )
    this.worldWorker!.postMessage({ id, input }, buffers)
  }

  private _onWorldComputed({ id, data }: { id: number; data: BlocksData }) {
    const job = this.worldBusy
    this.worldBusy = null
    if (this.bot && job?.id === id && job.bot === this.bot) {
      setBlocksData(this.bot, data)
      this._sendWorldView()
    }
    const pending = this.worldPending
    this.worldPending = null
    if (pending?.bot === this.bot && this.worldWorker) this._queueWorldCompute(pending.bot, pending.input)
  }

  // Reads what changed in the world (cheap, here) and has the payload built (in the worker).
  private _emitWorld() {
    const bot = this.bot
    if (!bot?.entity || !bot.world) return
    try {
      const slice = readSlice(bot)
      if (slice) {
        const input = computeInput(bot, slice)
        if (this._worldWorker()) this._queueWorldCompute(bot, input)
        else setBlocksData(bot, computeBlocks(input))
      }
      this._sendWorldView()
    } catch (error) {
      console.error('[BotManager] Failed to build world view', error)
    }
  }

  // Sends the inventory and the latest built blocks when either changed.
  private _sendWorldView() {
    try {
      const view = getWorldView(this.bot, { cachedBlocks: true })
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
    return getWorldView(this.bot, { cachedBlocks: Boolean(this._worldWorker()) })
  }

  async interactBlock(position: Vec3Like) {
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
  async buildAction(action: BuildAction): Promise<string> {
    const bot = this.bot
    if (!bot?.entity) throw new Error('The bot is not connected.')
    const running = this.buildRun
    if (running) {
      // The same kind (and for placing, the same block in hand) joins the line being built.
      const sameKind =
        running.type === action?.type && (action.type !== 'place' || bot.heldItem?.name === running.itemName)
      if (sameKind && Array.isArray(action.cells)) {
        running.feed.incoming.push({ cells: action.cells, face: action.type === 'place' ? action.face : undefined })
        return `Added ${action.cells.length} more.`
      }
      this.buildQueue.push(action)
      this._emitBuildCells()
      return `Queued ${action?.type === 'place' ? 'placing' : 'breaking'} ${action?.cells?.length ?? 0} for after this.`
    }
    return this._runBuild(action)
  }

  private async _runBuild(action: BuildAction): Promise<string> {
    const bot = this.bot!
    let stop: () => void = () => {}
    const stopped = new Promise<void>((resolve) => (stop = resolve))
    const run: BuildRun = {
      cancelled: false,
      stop: () => stop(),
      stopped,
      type: action?.type,
      itemName: bot.heldItem?.name ?? null,
      feed: { incoming: [] },
    }
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
            (error) => this.emit('notice', (error as Error | undefined)?.message || 'That did not work.')
          )
        }, 0)
      }
    }
  }

  // The blocks still to break and to place (the running line and queued ones), for the watcher.
  private _emitBuildCells() {
    const cells: BuildCells = { break: [], place: [] }
    const run = this.buildRun
    if (run?.remaining && run.type && cells[run.type]) cells[run.type].push(...run.remaining)
    for (const job of this.buildQueue) {
      if (job?.type && cells[job.type] && Array.isArray(job.cells)) cells[job.type].push(...job.cells)
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
  async openTrader(entityId: number) {
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
      ;(window as unknown as EventEmitter).once('close', () => {
        if (this.trader === window) this.trader = null
      })
      this._emitWorld()
      return describeTrades(bot, window)
    } finally {
      this.openingBlock = false
    }
  }

  async trade(index: number, count: number) {
    const bot = this.bot
    const window = this.trader
    if (!bot || !window || bot.currentWindow !== (window as unknown)) throw new Error('The trade window is closed.')
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
    const bot = this.bot
    if (window && bot && bot.currentWindow === (window as unknown)) bot.closeWindow(window as never)
    this._emitWorld()
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
    this._emitWorld()
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
    const targets = this.mining._targetLabel()
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

  isTrusted(name: unknown) {
    return typeof name === 'string' && this.trustedPlayers.has(name.toLowerCase())
  }

  // The 3D view's render distance (blocks out from the bot), from the app's graphics settings. Kept for the
  // next connection too. A change reads the whole resized area again.
  setRenderDistance(blocks: unknown) {
    const radius = Math.round(Number(blocks))
    if (!Number.isFinite(radius) || radius < 16 || radius > 120) return false
    this.renderDistance = radius
    const bot = this.bot
    if (bot && bot._worldRadius !== radius) {
      bot._worldRadius = radius
      bot._worldDirty = true
      this._scheduleWorldEmit(0)
    }
    return true
  }

  setTrustedPlayers(names: unknown) {
    this.trustedPlayers.clear()
    for (const name of Array.isArray(names) ? names : []) {
      if (typeof name === 'string' && name.trim()) this.trustedPlayers.add(name.trim().toLowerCase())
    }
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

  dismissBedPickup() {
    this.bed.dismissPickup()
    this._emitState()
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

  getAutoEatOptions() {
    return this.autoEat.getOptions()
  }

  setPathfinderOptions(options: Partial<PathfinderOptions> | null | undefined) {
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

  followEntity(entityId: number) {
    const entity = this.bot?.entities?.[entityId]
    if (!entity?.isValid || entity === this.bot?.entity || entity.name === 'item') {
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
  attackEntity(entityId: number) {
    this._cancelDoorOperation()
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

  private _isDoorBlock(name: unknown): name is string {
    return (
      typeof name === 'string' &&
      (name.endsWith('_door') || name === 'door' || name === 'wooden_door') &&
      !name.endsWith('trapdoor')
    )
  }

  private _cancelDoorOperation() {
    if (this.doorOperation) {
      this.doorOperation.aborted = true
      if (this.doorOperation.interval) clearInterval(this.doorOperation.interval)
      if (this.doorOperation.timeout) clearTimeout(this.doorOperation.timeout)
      this.doorOperation = null
    }
  }

  // Toggles a door (opens if closed, closes if open) as soon as the bot gets within interaction reach.
  private _scheduleDoorOpen(doorLocation: Vec3Like) {
    this._cancelDoorOperation()

    const pos = new Vec3(Math.floor(doorLocation.x), Math.floor(doorLocation.y), Math.floor(doorLocation.z))
    const initialBlock = this.bot?.blockAt(pos)
    const initialProps = typeof initialBlock?.getProperties === 'function' ? initialBlock.getProperties() : {}
    const wasOpen = initialProps.open === true || initialProps.open === 'true'

    const op: DoorOperation = { aborted: false, interval: null, timeout: null }
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
      const bot = this.bot
      if (op.aborted || !bot?.entity) {
        cleanup()
        return
      }

      const block = bot.blockAt(pos)
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
      const eyePos = bot.entity.position.offset(0, 1.6, 0)
      const distance = eyePos.distanceTo(doorCenter)

      // Player reach is 4.5; within 3.5 blocks we can comfortably interact with the door without crowding it
      if (distance <= 3.5) {
        cleanup()
        try {
          bot.pathfinder?.stop()
          bot.pathfinder?.setGoal(null)
        } catch {}

        const doorBlock = bot.blockAt(lowerPos) || block
        const actionLabel = wasOpen ? 'Closed' : 'Opened'
        try {
          await bot.lookAt(doorCenter)
          await bot.activateBlock(doorBlock)
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
  async openDoor(location: Vec3Like, standLocation?: Vec3Like) {
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

  setPvpOptions(options: Partial<PvpOptions> | null | undefined) {
    return this.behavior.setPvpOptions(options || {})
  }

  getPvpOptions() {
    return this.behavior.getPvpOptions()
  }
}

const botManager = new BotManager()
export default botManager
