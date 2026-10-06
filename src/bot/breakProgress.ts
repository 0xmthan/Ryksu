// Blocks being broken, for the watcher's crack overlay (the game's 10 destroy stages): the bot's own digging
// (first person, build mode, Auto Mine), timed from the block's dig time, and other players' from the
// server's break animation packets. Also reports a block the bot finished breaking, for the particles.
import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'
import { Vec3 } from 'vec3'
import type { BreakingState } from '../types'

type Crack = BreakingState['cracks'][number]
type OwnDig = { x: number; y: number; z: number; name: string; start: number; total: number }

const POLL_MS = 50
const STAGES = 10

export class BreakProgress {
  private onChange: (state: BreakingState) => void
  private bot: Bot | null
  private timer: ReturnType<typeof setInterval> | null
  private observed: Map<string, Crack>
  private own: OwnDig | null
  private lastSent: string

  constructor({ onChange }: { onChange: (state: BreakingState) => void }) {
    this.onChange = onChange
    this.bot = null
    this.timer = null
    // Other players' cracks by "x,y,z".
    this.observed = new Map()
    this.own = null
    this.lastSent = ''
    this._observe = this._observe.bind(this)
    this._observeEnd = this._observeEnd.bind(this)
  }

  attach(bot: Bot) {
    this.detach()
    this.bot = bot
    bot.on('blockBreakProgressObserved', this._observe)
    bot.on('blockBreakProgressEnd', this._observeEnd)
    this.timer = setInterval(() => this._poll(), POLL_MS)
  }

  detach() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.bot) {
      this.bot.removeListener('blockBreakProgressObserved', this._observe)
      this.bot.removeListener('blockBreakProgressEnd', this._observeEnd)
    }
    this.bot = null
    this.observed.clear()
    this.own = null
    this.lastSent = ''
  }

  private _observe(block: Block, stage: number) {
    if (!block?.position) return
    const { x, y, z } = block.position
    this.observed.set(`${x},${y},${z}`, { x, y, z, stage: Math.max(0, Math.min(STAGES - 1, stage)) })
    this._send()
  }

  private _observeEnd(block: Block) {
    if (!block?.position) return
    const { x, y, z } = block.position
    this.observed.delete(`${x},${y},${z}`)
    this._send()
  }

  private _poll() {
    const bot = this.bot
    if (!bot) return
    const target = bot.targetDigBlock
    let broken: BreakingState['broken'] = null
    if (target) {
      const { x, y, z } = target.position
      if (!this.own || this.own.x !== x || this.own.y !== y || this.own.z !== z) {
        let total = Infinity
        try {
          total = bot.digTime(target)
        } catch {
          // Unknown block; no cracks.
        }
        this.own = { x, y, z, name: target.name, start: performance.now(), total }
      }
    } else if (this.own) {
      // Digging ended: broken if the block changed (to air, or water for a waterlogged one), else stopped.
      const block = bot.blockAt(new Vec3(this.own.x, this.own.y, this.own.z))
      if (!block || block.name !== this.own.name) {
        broken = { x: this.own.x, y: this.own.y, z: this.own.z, name: this.own.name }
      }
      this.own = null
    }
    this._send(broken)
  }

  private _send(broken: BreakingState['broken'] = null) {
    const cracks = [...this.observed.values()]
    const own = this.own
    if (own && Number.isFinite(own.total) && own.total > 0) {
      const progress = (performance.now() - own.start) / own.total
      cracks.push({
        x: own.x,
        y: own.y,
        z: own.z,
        stage: Math.min(STAGES - 1, Math.floor(progress * STAGES)),
      })
    }
    const key = JSON.stringify(cracks)
    if (key === this.lastSent && !broken) return
    this.lastSent = key
    this.onChange({ cracks, broken })
  }
}
