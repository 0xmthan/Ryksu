// Build mode: breaks a line of blocks, or places the held block along one. One line runs at a time; more
// drags of the same kind join it, other ones wait their turn, and cancel() stops everything.
import type { Bot } from 'mineflayer'
import type { Vec3Like } from '../ipc'
import type { BuildAction, BuildCells } from '../types'
import { buildCells, type BuildFeed } from './building'

type BuildRun = {
  cancelled: boolean
  stop: () => void
  stopped: Promise<void>
  type: BuildAction['type'] | undefined
  itemName: string | null
  feed: BuildFeed
  remaining?: Vec3Like[]
}

export class BuildQueue {
  private getBot: () => Bot | null
  // Frees the bot from whatever else it was doing before a line starts.
  private takeControl: () => void
  private equipTool: () => boolean
  private onNotice: (text: string) => void
  private onCells: (cells: BuildCells) => void
  private onDone: () => void
  // Jobs waiting for the running one (a different kind of drag, or another block).
  private queue: BuildAction[] = []
  private run: BuildRun | null = null

  constructor(options: {
    getBot: () => Bot | null
    takeControl: () => void
    equipTool: () => boolean
    onNotice: (text: string) => void
    // The blocks still to break and place, for the watcher to mark.
    onCells: (cells: BuildCells) => void
    // A line finished or stopped, so the world view can be sent right away.
    onDone: () => void
  }) {
    this.getBot = options.getBot
    this.takeControl = options.takeControl
    this.equipTool = options.equipTool
    this.onNotice = options.onNotice
    this.onCells = options.onCells
    this.onDone = options.onDone
  }

  async add(action: BuildAction): Promise<string> {
    const bot = this.getBot()
    if (!bot?.entity) throw new Error('The bot is not connected.')
    const running = this.run
    if (running) {
      // The same kind (and for placing, the same block in hand) joins the line being built.
      const sameKind =
        running.type === action?.type && (action.type !== 'place' || bot.heldItem?.name === running.itemName)
      if (sameKind && Array.isArray(action.cells)) {
        running.feed.incoming.push({ cells: action.cells, face: action.type === 'place' ? action.face : undefined })
        return `Added ${action.cells.length} more.`
      }
      this.queue.push(action)
      this.emitCells()
      return `Queued ${action?.type === 'place' ? 'placing' : 'breaking'} ${action?.cells?.length ?? 0} for after this.`
    }
    return this.start(bot, action)
  }

  // Stops a build right away: the dig or walk in progress too, and frees the bot for the next one.
  // True if something was running or queued.
  cancel() {
    const queued = this.queue.length > 0
    this.queue = []
    const run = this.run
    if (run) run.remaining = []
    this.emitCells()
    if (!run) return queued
    run.cancelled = true
    run.stop()
    this.run = null
    const bot = this.getBot()
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

  private async start(bot: Bot, action: BuildAction): Promise<string> {
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
    this.run = run
    const sameBot = () => bot === this.getBot()
    try {
      this.takeControl()
      return await buildCells(bot, action, {
        equipTool: this.equipTool(),
        onProgress: (text) => {
          if (!run.cancelled) this.onNotice(text)
        },
        isCancelled: () => run.cancelled || !sameBot(),
        stopped: run.stopped,
        feed: run.feed,
        onRemaining: (cells) => {
          run.remaining = cells
          this.emitCells()
        },
      })
    } finally {
      if (this.run === run) this.run = null
      this.emitCells()
      if (sameBot()) this.onDone()
      // The next queued job starts once this one's result has gone back; its own result shows as a notice.
      const next = !run.cancelled && sameBot() ? this.queue.shift() : null
      if (next) {
        setTimeout(() => {
          this.start(bot, next).then(
            (message) => this.onNotice(message),
            (error) => this.onNotice((error as Error | undefined)?.message || 'That did not work.')
          )
        }, 0)
      }
    }
  }

  // The blocks still to break and to place (the running line and queued ones), for the watcher.
  private emitCells() {
    const cells: BuildCells = { break: [], place: [] }
    const run = this.run
    if (run?.remaining && run.type && cells[run.type]) cells[run.type].push(...run.remaining)
    for (const job of this.queue) {
      if (job?.type && cells[job.type] && Array.isArray(job.cells)) cells[job.type].push(...job.cells)
    }
    this.onCells(cells)
  }
}
