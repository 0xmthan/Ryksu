import type { Bot } from 'mineflayer'
import type { ChatMessage } from '../../shared/types'
import { rememberName } from './entities/playerNames'

// Whatever forwards new chat lines (the bot manager).
type ChatEmitter = { emit(event: 'chat', entry: ChatMessage): unknown }
type AuthConfig = { password: string; registerSent: boolean; loginSent: boolean }
type ChatHandlers = {
  messagestr: (message: unknown, position: unknown, json: unknown, sender: unknown) => void
  message: (component: unknown) => void
}

const stripFormattingCodes = (value: string) => value.replace(/§[0-9a-fklmnor]/gi, '')

const createEntryId = (suffix?: string) =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${suffix ? `-${suffix}` : ''}`

const plainUuid = (uuid: unknown) => String(uuid).replace(/-/g, '').toLowerCase()

// Which player a chat line is from: the sender's UUID on signed player chat, else "<Name>" (vanilla) or a
// "[Rank] Name: …" style prefix, as long as Name is someone on the server.
const chatPlayer = (bot: Bot, text: string, sender: unknown): string | null => {
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

export class ChatBridge {
  private emitter: ChatEmitter | null
  private chatLog: ChatMessage[]
  private authConfig: AuthConfig | null
  private handlers: ChatHandlers | null
  private botUsername: string

  constructor(emitter: ChatEmitter | null) {
    this.emitter = emitter
    this.chatLog = []
    this.authConfig = null
    this.handlers = null
    this.botUsername = ''
  }

  prepareForConnection(password: string | null | undefined, botUsername = '') {
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

  attach(bot: Bot | null) {
    if (!bot) {
      return
    }

    this.detach(bot)

    const handleMessageStr: ChatHandlers['messagestr'] = (message, position, _json, sender) => {
      const rawText = typeof message === 'string' ? message : String(message ?? '')
      const text = stripFormattingCodes(rawText).trim()
      if (!text) {
        return
      }

      const senderName =
        sender && typeof sender === 'object' ? (sender as { username?: unknown }).username : undefined
      const entry: ChatMessage = {
        id: createEntryId(),
        text,
        author: typeof senderName === 'string' && senderName.length > 0 ? senderName : 'Server',
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

    const handleMessageComponent: ChatHandlers['message'] = (component) => {
      if (!component) {
        return
      }

      let rawText = ''
      try {
        if (typeof component === 'string') {
          rawText = component
        } else if (typeof (component as { toString?: unknown }).toString === 'function') {
          rawText = String(component)
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

    // Mineflayer's listener types are narrower than what the handlers accept.
    bot.on('messagestr', handleMessageStr as never)
    bot.on('message', handleMessageComponent as never)
  }

  detach(bot: Bot | null) {
    if (!bot || !this.handlers) {
      this.handlers = null
      return
    }

    const { messagestr, message } = this.handlers
    bot.removeListener('messagestr', messagestr as never)
    bot.removeListener('message', message as never)
    this.handlers = null
  }

  getHistory() {
    return this.chatLog.slice()
  }

  send(bot: Bot | null, message: unknown) {
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

  pushSystemMessage(text: string) {
    const entry: ChatMessage = {
      id: createEntryId('system'),
      text,
      author: this._getRyksuAuthor(),
      type: 'system',
      position: 'client',
      timestamp: Date.now(),
    }
    this._pushEntry(entry)
  }

  private _getRyksuAuthor() {
    const normalized = this.botUsername.trim()
    if (!normalized || normalized.toLowerCase() === 'ryksu') {
      return 'Ryksu'
    }

    return `Ryksu (${normalized})`
  }

  _pushEntry(entry: ChatMessage) {
    const last = this.chatLog[this.chatLog.length - 1]
    if (last && last.text === entry.text && last.author === entry.author) {
      return
    }

    this.chatLog.push(entry)

    if (this.emitter) {
      this.emitter.emit('chat', entry)
    }
  }

  private _attemptAutoAuth(bot: Bot, text: string) {
    if (!this.authConfig) {
      return
    }

    const { password, registerSent, loginSent } = this.authConfig
    if (!password) {
      return
    }

    const lower = text.toLowerCase()
    const needsRegister =
      !registerSent &&
      (lower.includes('/register') || lower.includes(' register') || lower.startsWith('register'))
    const needsLogin =
      !loginSent && (lower.includes('/login') || lower.includes(' login') || lower.startsWith('login'))

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

  private _ensureReady(bot: Bot) {
    if (!bot || !bot._client || bot._client.state !== 'play') {
      throw new Error('Bot is not ready to send chat messages yet.')
    }
  }
}
