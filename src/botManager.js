const { EventEmitter } = require('node:events')
const mineflayer = require('mineflayer')
const { SUPPORTED_VERSIONS } = require('./bot/versions')
const { normaliseError } = require('./bot/errors')
const { ChatBridge } = require('./bot/chatBridge')

class BotManager extends EventEmitter {
  constructor() {
    super()
    this.bot = null
    this.stateInterval = null
    this.chat = new ChatBridge(this)
  }

  getSupportedVersions() {
    return SUPPORTED_VERSIONS
  }

  async connect(options) {
    await this.disconnect()

    const { host, port, username, accountType, password, version, offlinePassword } = options

    let selectedVersion = version

    if (!selectedVersion || selectedVersion === 'auto') {
      selectedVersion = SUPPORTED_VERSIONS[0]
    }

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

    this.chat.prepareForConnection(accountType === 'offline' ? offlinePassword : null)

    const connectingMessage = selectedVersion
      ? `Connecting with Minecraft ${selectedVersion}…`
      : 'Connecting to server…'
    this.emit('status', { stage: 'connecting', message: connectingMessage })

    return new Promise((resolve, reject) => {
      let settled = false

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
        rejectOnce(error)
      }

      const handleEnd = () => {
        this.emit('status', { stage: 'disconnected', message: 'Bot disconnected.' })
        this._stopStateStream()
        if (this.bot) {
          this.chat.detach(this.bot)
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
}

module.exports = new BotManager()
