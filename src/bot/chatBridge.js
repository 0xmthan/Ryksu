const { rememberName } = require('./playerNames')

const stripFormattingCodes = (value) => value.replace(/§[0-9a-fklmnor]/gi, '')

const createEntryId = (suffix) =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${suffix ? `-${suffix}` : ''}`

const plainUuid = (uuid) => String(uuid).replace(/-/g, '').toLowerCase()

// Which player a chat line is from: the sender's UUID on signed player chat, else "<Name>" (vanilla) or a
// "[Rank] Name: …" style prefix, as long as Name is someone on the server.
const chatPlayer = (bot, text, sender) => {
  if (typeof sender === 'string') {
    const id = plainUuid(sender)
    const player = Object.values(bot.players ?? {}).find((candidate) => plainUuid(candidate.uuid) === id)
    if (player?.username) return player.username
  }
  const vanilla = text.match(/^<([A-Za-z0-9_]{1,16})>/)
  if (vanilla) return vanilla[1]
  const prefixed = text.match(/^(?:\[[^\]]{0,24}\]\s*)*([A-Za-z0-9_]{1,16})\s*(?::|»|>|›|\|)/)
  return prefixed && bot.players?.[prefixed[1]] ? prefixed[1] : null
}

class ChatBridge {
  constructor(emitter) {
    this.emitter = emitter
    this.chatLog = []
    this.authConfig = null
    this.handlers = null
    this.botUsername = ''
  }

  prepareForConnection(password, botUsername = '') {
    if (typeof password === 'string' && password.trim().length > 0) {
      this.authConfig = {
        password: password.trim(),
        registerSent: false,
        loginSent: false,
      }
    } else {
      this.authConfig = null
    }
    this.botUsername = typeof botUsername === 'string' ? botUsername.trim() : ''
    this.chatLog = []
  }

  clear() {
    this.chatLog = []
    this.authConfig = null
    this.handlers = null
    this.botUsername = ''
  }

  attach(bot) {
    if (!bot) {
      return
    }

    this.detach(bot)

    const handleMessageStr = (message, position, _json, sender) => {
      const rawText = typeof message === 'string' ? message : String(message ?? '')
      const text = stripFormattingCodes(rawText).trim()
      if (!text) {
        return
      }

      const entry = {
        id: createEntryId(),
        text,
        author:
          sender && typeof sender === 'object' && typeof sender.username === 'string' && sender.username.length > 0
            ? sender.username
            : 'Server',
        type: sender ? 'chat' : 'system',
        position: typeof position === 'string' ? position : null,
        timestamp: Date.now(),
      }
      const player = chatPlayer(bot, text, sender)
      if (player) {
        entry.player = player
        rememberName(bot, player)
      }

      this._pushEntry(entry)
      this._attemptAutoAuth(bot, entry.text)
    }

    const handleMessageComponent = (component) => {
      if (!component) {
        return
      }

      let rawText = ''
      try {
        if (typeof component === 'string') {
          rawText = component
        } else if (typeof component.toString === 'function') {
          rawText = component.toString()
        }
      } catch {
        rawText = ''
      }

      const text = stripFormattingCodes(rawText).trim()
      if (!text) {
        return
      }

      const player = chatPlayer(bot, text, null)
      if (player) rememberName(bot, player)
      this._pushEntry({
        id: createEntryId(),
        text,
        author: 'Server',
        type: 'system',
        position: null,
        timestamp: Date.now(),
        ...(player ? { player } : {}),
      })

      this._attemptAutoAuth(bot, text)
    }

    this.handlers = {
      messagestr: handleMessageStr,
      message: handleMessageComponent,
    }

    bot.on('messagestr', handleMessageStr)
    bot.on('message', handleMessageComponent)
  }

  detach(bot) {
    if (!bot || !this.handlers) {
      this.handlers = null
      return
    }

    const { messagestr, message } = this.handlers
    bot.removeListener('messagestr', messagestr)
    bot.removeListener('message', message)
    this.handlers = null
  }

  getHistory() {
    return this.chatLog.slice()
  }

  send(bot, message) {
    if (!bot) {
      throw new Error('Bot is not connected.')
    }

    const trimmed = typeof message === 'string' ? message.trim() : ''
    if (!trimmed) {
      return
    }

    this._ensureReady(bot)

    bot.chat(trimmed)
  }

  pushSystemMessage(text) {
    const entry = {
      id: createEntryId('system'),
      text,
      author: this._getRyksuAuthor(),
      type: 'system',
      position: 'client',
      timestamp: Date.now(),
    }
    this._pushEntry(entry)
  }

  _getRyksuAuthor() {
    const normalized = this.botUsername.trim()
    if (!normalized || normalized.toLowerCase() === 'ryksu') {
      return 'Ryksu'
    }

    return `Ryksu (${normalized})`
  }

  _pushEntry(entry) {
    const last = this.chatLog[this.chatLog.length - 1]
    if (last && last.text === entry.text && last.author === entry.author) {
      return
    }

    this.chatLog.push(entry)

    if (this.emitter) {
      this.emitter.emit('chat', entry)
    }
  }

  _attemptAutoAuth(bot, text) {
    if (!this.authConfig) {
      return
    }

    const { password, registerSent, loginSent } = this.authConfig
    if (!password) {
      return
    }

    const lower = text.toLowerCase()
    const needsRegister = !registerSent && (lower.includes('/register') || lower.includes(' register') || lower.startsWith('register'))
    const needsLogin = !loginSent && (lower.includes('/login') || lower.includes(' login') || lower.startsWith('login'))

    if (!needsRegister && !needsLogin) {
      return
    }

    const command = needsRegister ? `/register ${password} ${password}` : `/login ${password}`

    try {
      this._ensureReady(bot)
      bot.chat(command)
      if (needsRegister) {
        this.authConfig.registerSent = true
      } else {
        this.authConfig.loginSent = true
        this.authConfig = null
      }
      this.pushSystemMessage(`Sent ${needsRegister ? '/register' : '/login'} command automatically.`)
    } catch {
      this.pushSystemMessage(
        `Failed to send ${needsRegister ? '/register' : '/login'} automatically. Try entering it manually.`
      )
    }
  }

  _ensureReady(bot) {
    if (!bot || !bot._client || bot._client.state !== 'play') {
      throw new Error('Bot is not ready to send chat messages yet.')
    }
  }
}

module.exports = {
  ChatBridge,
}
