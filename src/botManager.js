const { EventEmitter } = require('node:events')
const mineflayer = require('mineflayer')
const { SUPPORTED_VERSIONS } = require('./bot/versions')
const { normaliseError } = require('./bot/errors')
const { ChatBridge } = require('./bot/chatBridge')
const { ArmorManagerController } = require('./bot/plugins/armorManager')
const { AutoEatController } = require('./bot/plugins/autoEat')
const { AutoToolController } = require('./bot/plugins/autoTool')
const { AutoShieldController } = require('./bot/plugins/autoShield')
const { PathfinderController } = require('./bot/plugins/pathfinder')
const { PvpController } = require('./bot/plugins/pvp')
const { BehaviorManager } = require('./bot/plugins/behaviorManager')
const MICROSOFT_LINK_URL = 'https://www.microsoft.com/link'
const PLUGIN_PACKET_WARNING = 'The server or one of its plugins sent a packet Ryksu could not parse.'

const isIgnorablePluginPacketError = (error) => {
  const message = typeof error?.message === 'string' ? error.message : typeof error === 'string' ? error : ''
  return (
    message.includes('Chunk size is') &&
    message.includes('partial packet') &&
    message.includes('player_info')
  )
}

class BotManager extends EventEmitter {
  constructor() {
    super()
    this.bot = null
    this.stateInterval = null
    this.chat = new ChatBridge(this)
    this.armorManager = new ArmorManagerController()
    this.autoEat = new AutoEatController()
    this.autoTool = new AutoToolController()
    this.autoShield = new AutoShieldController()
    this.pathfinder = new PathfinderController()
    this.pvp = new PvpController({ autoTool: this.autoTool, autoShield: this.autoShield })
    this.behavior = new BehaviorManager({ pathfinder: this.pathfinder, pvp: this.pvp })
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
          typeof data?.message === 'string'
            ? data.message.match(/https?:\/\/\S+/i)?.[0]?.trim()
            : undefined

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

      const cleanup = (removePersistentHandlers = true) => {
        if (this.bot) {
          this.bot.removeListener('login', handleLogin)
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

      this.armorManager.attach(this.bot)
      this.autoEat.attach(this.bot)
      this.autoTool.attach(this.bot)
      this.autoShield.attach(this.bot)
      this.pathfinder.attach(this.bot)
      this.pvp.attach(this.bot)
      this.behavior.applyCurrentState()

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
        const friendlyError = normaliseError(reason, botOptions)
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
    this.bot.removeAllListeners()
    this.bot = null
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
  }

  _stopStateStream() {
    if (this.stateInterval) {
      clearInterval(this.stateInterval)
      this.stateInterval = null
    }
  }

  _emitState() {
    const snapshot = this.getSnapshot()
    if (!snapshot) {
      return
    }

    this.emit('state', snapshot)
  }

  getChatHistory() {
    return this.chat.getHistory()
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
    return this.behavior.setPathfinderOptions(options || {})
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
