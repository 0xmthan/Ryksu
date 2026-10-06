// Goes to bed on its own when everyone else on the server already is, so the bot isn't the one keeping
// the night from passing. The server's "X/Y players sleeping" message counts the whole server; when it
// hasn't sent one, every other player has to be in sight and lying in a bed.
import type { Bot } from 'mineflayer'
import type { Entity } from 'prismarine-entity'
import { entityEvents } from '../entityEvents'
import { canSleepNow, type BedController } from './bed'

const CHECK_INTERVAL_MS = 2000
// How long a "players sleeping" count is trusted without a newer one.
const REPORT_FRESH_MS = 15000
// After a failed try (no bed, can't reach it, …), wait before trying again.
const RETRY_DELAY_MS = 60000
const SLEEPING_POSE = 2

// "sleep.players_sleeping" carries [sleeping, total] as text components or plain numbers.
const argNumber = (arg: unknown) => {
  if (typeof arg !== 'object' || !arg) return Number(arg)
  const text = Number(arg.toString?.())
  return Number.isFinite(text) ? text : Number((arg as { text?: unknown }).text)
}

export class AutoSleep {
  private bed: BedController
  private isBusy: () => boolean
  private onMessage: (text: string) => void
  private bot: Bot | null
  private interval: ReturnType<typeof setInterval> | null
  private report: { sleeping: number; total: number; at: number } | null
  private trying: boolean
  private retryAt: number

  constructor({
    bed,
    isBusy,
    onMessage,
  }: {
    bed: BedController
    isBusy: () => boolean
    onMessage: (text: string) => void
  }) {
    this.bed = bed
    this.isBusy = isBusy
    this.onMessage = onMessage
    this.bot = null
    this.interval = null
    this.report = null
    this.trying = false
    this.retryAt = 0
    this._handleMessage = this._handleMessage.bind(this)
  }

  attach(bot: Bot) {
    this.detach()
    this.bot = bot
    bot.on('message', this._handleMessage)
    this.interval = setInterval(() => this._check(), CHECK_INTERVAL_MS)
  }

  detach() {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    this.bot?.removeListener('message', this._handleMessage)
    this.bot = null
    this.report = null
    this.trying = false
    this.retryAt = 0
  }

  private _handleMessage(message: { translate?: string; with?: unknown[] } | null) {
    if (message?.translate !== 'sleep.players_sleeping') return
    const [sleeping, total] = (message.with ?? []).map(argNumber)
    if (Number.isFinite(sleeping) && Number.isFinite(total)) {
      this.report = { sleeping, total, at: Date.now() }
    }
  }

  private _isAsleep(bot: Bot, entity: Entity) {
    const pose = entityEvents(bot, entity).typed.pose
    return pose === SLEEPING_POSE || pose === 'sleeping'
  }

  private _othersAsleep(bot: Bot) {
    const others = Object.values(bot.players ?? {}).filter((player) => player.username !== bot.username)
    if (!others.length) return false
    const report = this.report
    if (report && Date.now() - report.at < REPORT_FRESH_MS) {
      // The bot isn't in bed yet, so "everyone else" is one short of the total.
      return report.sleeping > 0 && report.sleeping >= report.total - 1
    }
    return others.every((player) => player.entity && this._isAsleep(bot, player.entity))
  }

  private _check() {
    const bot = this.bot
    if (!bot?.entity || bot.isSleeping || this.trying || Date.now() < this.retryAt) return
    if (!canSleepNow(bot) || this.isBusy() || !this._othersAsleep(bot)) return
    this.trying = true
    this.onMessage('Everyone else is asleep, going to bed.')
    this.bed
      .useNearestBed()
      .then((result) => {
        if (!result.sleeping) this.retryAt = Date.now() + RETRY_DELAY_MS
      })
      .catch((error) => {
        this.retryAt = Date.now() + RETRY_DELAY_MS
        this.onMessage(`Couldn't go to bed: ${(error as Error | undefined)?.message ?? 'unknown error'}`)
      })
      .finally(() => {
        this.trying = false
      })
  }
}
