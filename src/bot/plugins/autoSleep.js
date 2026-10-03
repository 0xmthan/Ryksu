// Goes to bed on its own when everyone else on the server already is, so the bot isn't the one keeping
// the night from passing. The server's "X/Y players sleeping" message counts the whole server; when it
// hasn't sent one, every other player has to be in sight and lying in a bed.
const { canSleepNow } = require('./bed')
const { entityEvents } = require('../entityEvents')

const CHECK_INTERVAL_MS = 2000
// How long a "players sleeping" count is trusted without a newer one.
const REPORT_FRESH_MS = 15000
// After a failed try (no bed, can't reach it, …), wait before trying again.
const RETRY_DELAY_MS = 60000
const SLEEPING_POSE = 2

// "sleep.players_sleeping" carries [sleeping, total] as text components or plain numbers.
const argNumber = (arg) => {
  if (typeof arg !== 'object' || !arg) return Number(arg)
  const text = Number(arg.toString?.())
  return Number.isFinite(text) ? text : Number(arg.text)
}

class AutoSleep {
  constructor({ bed, isBusy, onMessage }) {
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

  attach(bot) {
    this.detach()
    this.bot = bot
    bot.on('message', this._handleMessage)
    this.interval = setInterval(() => this._check(), CHECK_INTERVAL_MS)
  }

  detach() {
    clearInterval(this.interval)
    this.interval = null
    this.bot?.removeListener('message', this._handleMessage)
    this.bot = null
    this.report = null
    this.trying = false
    this.retryAt = 0
  }

  _handleMessage(message) {
    if (message?.translate !== 'sleep.players_sleeping') return
    const [sleeping, total] = (message.with ?? []).map(argNumber)
    if (Number.isFinite(sleeping) && Number.isFinite(total)) {
      this.report = { sleeping, total, at: Date.now() }
    }
  }

  _isAsleep(entity) {
    const pose = entityEvents(this.bot, entity).typed.pose
    return pose === SLEEPING_POSE || pose === 'sleeping'
  }

  _othersAsleep() {
    const bot = this.bot
    const others = Object.values(bot.players ?? {}).filter((player) => player.username !== bot.username)
    if (!others.length) return false
    const report = this.report
    if (report && Date.now() - report.at < REPORT_FRESH_MS) {
      // The bot isn't in bed yet, so "everyone else" is one short of the total.
      return report.sleeping > 0 && report.sleeping >= report.total - 1
    }
    return others.every((player) => player.entity && this._isAsleep(player.entity))
  }

  _check() {
    const bot = this.bot
    if (!bot?.entity || bot.isSleeping || this.trying || Date.now() < this.retryAt) return
    if (!canSleepNow(bot) || this.isBusy() || !this._othersAsleep()) return
    this.trying = true
    this.onMessage('Everyone else is asleep, going to bed.')
    this.bed
      .useNearestBed()
      .then((result) => {
        if (!result.sleeping) this.retryAt = Date.now() + RETRY_DELAY_MS
      })
      .catch((error) => {
        this.retryAt = Date.now() + RETRY_DELAY_MS
        this.onMessage(`Couldn't go to bed: ${error?.message ?? 'unknown error'}`)
      })
      .finally(() => {
        this.trying = false
      })
  }
}

module.exports = { AutoSleep }
