// Accepts teleport requests (/tpa, /tpahere) from trusted players. Only server messages count, not player
// chat, so nobody can fake one by typing it; and the accept names the player, so it only ever takes theirs.
import type { Bot } from 'mineflayer'

// Essentials, CMI, HuskHomes and friends: "Steve wants to teleport to you.", "Steve has requested to teleport
// to you.", "Steve wants you to teleport to them.", "Steve has requested that you teleport to them."
const REQUEST =
  /^(?:\[[^\]]*\]\s*)*([A-Za-z0-9_]{1,16}) (?:wants to teleport to you|wants you to teleport to them|has requested to teleport to you|has requested that you teleport to them)\b/i

// The same request often comes as two or three lines; accept it once.
const REPEAT_MS = 3000

export const tpaRequester = (text: string) => REQUEST.exec(text.trim())?.[1] ?? null

export class TpaAccept {
  private isTrusted: (name: string) => boolean
  private onAccept: (name: string) => void
  private bot: Bot | null
  private lastAccepted: Map<string, number>

  constructor({
    isTrusted,
    onAccept,
  }: {
    isTrusted: (name: string) => boolean
    onAccept: (name: string) => void
  }) {
    this.isTrusted = isTrusted
    this.onAccept = onAccept
    this.bot = null
    this.lastAccepted = new Map()
    this._handleMessage = this._handleMessage.bind(this)
  }

  attach(bot: Bot) {
    this.detach()
    this.bot = bot
    bot.on('messagestr', this._handleMessage)
  }

  detach() {
    this.bot?.removeListener('messagestr', this._handleMessage)
    this.bot = null
    this.lastAccepted.clear()
  }

  private _handleMessage(text: string, position: string) {
    const bot = this.bot
    if (!bot || position === 'chat') return
    const name = tpaRequester(text)
    if (!name || name.toLowerCase() === bot.username?.toLowerCase() || !this.isTrusted(name)) return
    const key = name.toLowerCase()
    const now = Date.now()
    if (now - (this.lastAccepted.get(key) ?? 0) < REPEAT_MS) return
    this.lastAccepted.set(key, now)
    bot.chat(`/tpaccept ${name}`)
    this.onAccept(name)
  }
}
