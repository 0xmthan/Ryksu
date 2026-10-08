import type { Bot } from 'mineflayer'
import { AUTOMATIONS, isAutomation, type Automation } from '../bot/automation'
import type { Vec3Like } from '../../shared/ipc'
import type { ScriptWorld } from './scriptWorld'

// What the app gives scripts to drive the bot with (BotManager provides it).
export type ScriptTarget = {
  getBot(): Bot | null
  chat(text: string): void
  goto(position: Vec3Like, range: number): Promise<void>
  stopMoving(): void
  // Holds sneak until let go, or the script turns off.
  sneak(on: boolean): void
  // Each automatic feature: whether it's on now, and what the user picked for it.
  toggles(): Record<Automation, { on: boolean; yours: boolean }>
  setToggle(feature: Automation, on: boolean): void
  notify(title: string, text: string): void
  // Finding, breaking and using blocks, picking up drops, the inventory and chests.
  world: Pick<
    ScriptWorld,
    | 'blockAt'
    | 'findBlocks'
    | 'dig'
    | 'digAll'
    | 'useItemOn'
    | 'useItemOnAll'
    | 'collectDrops'
    | 'inventory'
    | 'freeSlots'
    | 'deposit'
    | 'withdraw'
  >
}

// Thrown into a script's pending calls when it's turned off.
export class ScriptStopped extends Error {
  constructor() {
    super('The script was turned off.')
  }
}

// One run of a script's start() or stop(). Ending it rejects the calls still waiting and removes the
// listeners and timers they set up.
export class Session {
  ended = false
  private cleanups = new Set<() => void>()

  end() {
    this.ended = true
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups.clear()
  }

  check() {
    if (this.ended) throw new ScriptStopped()
  }

  // Calls cleanup when the session ends, unless removed (with the returned function) first.
  onEnd(cleanup: () => void) {
    this.cleanups.add(cleanup)
    return () => this.cleanups.delete(cleanup)
  }

  // A promise settled by `setup`, which returns how to undo itself. Rejects when the session ends, and after
  // `timeoutMs` (if given) with `timeoutMessage`.
  wait<T>(
    setup: (resolve: (value: T) => void, reject: (error: unknown) => void) => () => void,
    timeoutMs?: number,
    timeoutMessage = 'Timed out.'
  ) {
    this.check()
    return new Promise<T>((resolve, reject) => {
      let settled = false
      let undo: (() => void) | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      const settle = (finish: () => void) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        removeEnd()
        undo?.()
        finish()
      }
      const removeEnd = this.onEnd(() => settle(() => reject(new ScriptStopped())))
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => settle(() => reject(new Error(timeoutMessage))), timeoutMs)
      }
      const teardown = setup(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error))
      )
      // Settled during setup: undo it right away.
      if (settled) teardown()
      else undo = teardown
    })
  }
}

// The run a call comes from, and running code (like an onChat handler) as part of one.
export type SessionScope = {
  current(): Session
  run<T>(session: Session, action: () => T): T
}

type Hooks = {
  log: (level: 'info' | 'error', text: string) => void
  status: (text: string) => void
  hideWorld: (hidden: boolean) => void
  notify: (text: string) => void
  // The script turning itself off.
  exit: (reason: string | null) => void
}

// A teleport moves the bot at least this far (smaller server corrections don't count).
const TELEPORT_MIN_DISTANCE = 2

const describe = (value: unknown) => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

// The `ryksu` object scripts call. Each call acts for the run it comes from (start()'s or stop()'s), and fails
// once that run is over.
export const createScriptApi = (target: ScriptTarget, scope: SessionScope, hooks: Hooks) => {
  const session = () => scope.current()
  const bot = () => {
    session().check()
    const current = target.getBot()
    if (!current?.entity) throw new Error('The bot is not in the world.')
    return current
  }
  // Event listeners run outside any script run, so they read the bot they were given, not through bot().
  const rounded = (current: Bot) => {
    const { x, y, z } = current.entity.position
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100 }
  }
  const position = () => rounded(bot())
  const positionOf = (value: unknown, call: string): Vec3Like => {
    const { x, y, z } = (value ?? {}) as Partial<Vec3Like>
    if (![x, y, z].every((part) => Number.isFinite(part))) {
      throw new Error(`${call} needs a position like { x: 0, y: 64, z: 0 }.`)
    }
    return { x: x!, y: y!, z: z! }
  }
  const orderOf = (order: unknown) => {
    if (order !== 'nearest' && order !== 'rows') {
      throw new Error(`Unknown order "${String(order)}". Orders: nearest, rows.`)
    }
    return order
  }
  // Something that walks the bot: turning the script off stops it where it is.
  const moving = <T>(action: Promise<T>) =>
    session().wait<T>((resolve, reject) => {
      action.then(resolve, reject)
      return () => target.stopMoving()
    })
  // Strings match case-insensitively anywhere in the message; regular expressions match as written.
  const matcher = (pattern: unknown) => {
    if (typeof (pattern as RegExp)?.test === 'function')
      return (text: string) => (pattern as RegExp).test(text)
    const needle = String(pattern).toLowerCase()
    return (text: string) => text.toLowerCase().includes(needle)
  }

  return {
    // Say something, or run a command ("/wp home").
    chat(text: unknown) {
      bot()
      target.chat(String(text))
    },

    wait(ms: unknown) {
      return session().wait<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, Number(ms) || 0))
        return () => clearTimeout(timer)
      })
    },

    // The next server message containing `pattern` (text or a regular expression).
    waitForChat(pattern: unknown, { timeout = 30_000 }: { timeout?: number } = {}) {
      const current = bot()
      const matches = matcher(pattern)
      return session().wait<string>(
        (resolve) => {
          const handle = (text: string, where: string) => {
            if (where !== 'game_info' && matches(text)) resolve(text)
          }
          current.on('messagestr', handle)
          return () => current.removeListener('messagestr', handle)
        },
        timeout,
        `No chat message matched "${String(pattern)}" within ${timeout / 1000}s.`
      )
    },

    // Calls `handler(text)` for every server message until the script stops. Returns a function to stop it.
    onChat(handler: unknown) {
      const current = bot()
      if (typeof handler !== 'function') throw new Error('ryksu.onChat needs a function.')
      // The handler runs as part of the run that set it up.
      const owner = session()
      const handle = (text: string, where: string) => {
        if (where === 'game_info' || owner.ended) return
        Promise.resolve()
          .then(() => scope.run(owner, () => handler(text)))
          .catch((error) => {
            if (!(error instanceof ScriptStopped))
              hooks.log('error', `onChat: ${(error as Error)?.message ?? error}`)
          })
      }
      current.on('messagestr', handle)
      const remove = () => current.removeListener('messagestr', handle)
      const forget = owner.onEnd(remove)
      return () => {
        forget()
        remove()
      }
    },

    // Resolves with the new position once the server teleports the bot (or moves it to another world).
    waitForTeleport({ timeout = 15_000 }: { timeout?: number } = {}) {
      const current = bot()
      const from = current.entity.position.clone()
      return session().wait<Vec3Like>(
        (resolve) => {
          const moved = () => {
            if (current.entity.position.distanceTo(from) >= TELEPORT_MIN_DISTANCE) resolve(rounded(current))
          }
          const spawned = () => resolve(rounded(current))
          current.on('forcedMove', moved)
          current.on('spawn', spawned)
          return () => {
            current.removeListener('forcedMove', moved)
            current.removeListener('spawn', spawned)
          }
        },
        timeout,
        `No teleport within ${timeout / 1000}s.`
      )
    },

    // Walks to a position, within `range` blocks.
    goto(to: unknown, { range = 1 }: { range?: number } = {}) {
      bot()
      const position = positionOf(to, 'ryksu.goto')
      return moving(target.goto(position, Math.max(0, Number(range) || 0)))
    },

    // The block at a position: { x, y, z, name, properties }, or null where the world isn't loaded.
    blockAt(at: unknown) {
      bot()
      return target.world.blockAt(positionOf(at, 'ryksu.blockAt'))
    },

    // Blocks called `name` near the bot, nearest first, like findBlocks('wheat', { properties: { age: 7 } }).
    findBlocks(name: unknown, options: { maxDistance?: number; count?: number; properties?: object } = {}) {
      bot()
      return target.world.findBlocks(String(name), options ?? {})
    },

    // Walks within reach of the block and breaks it.
    dig(at: unknown) {
      bot()
      return moving(target.world.dig(positionOf(at, 'ryksu.dig')))
    },

    // Breaks all the blocks (like findBlocks gives): everything in reach first, then on to the next one, the
    // nearest (order: 'nearest') or row by row (order: 'rows'). Resolves with { dug, skipped }.
    digAll(blocks: unknown, { order = 'nearest' }: { order?: unknown } = {}) {
      bot()
      if (!Array.isArray(blocks)) throw new Error('ryksu.digAll needs a list of blocks.')
      const owner = session()
      const positions = blocks.map((block) => positionOf(block, 'ryksu.digAll'))
      return moving(target.world.digAll(positions, { order: orderOf(order) }, () => !owner.ended))
    },

    // Uses the item on the top of all the blocks, like planting seeds on farmland, in the same way as digAll,
    // until it runs out. Resolves with { used, skipped }.
    useItemOnAll(blocks: unknown, item: unknown, { order = 'nearest' }: { order?: unknown } = {}) {
      bot()
      if (!Array.isArray(blocks)) throw new Error('ryksu.useItemOnAll needs a list of blocks.')
      const owner = session()
      const positions = blocks.map((block) => positionOf(block, 'ryksu.useItemOnAll'))
      return moving(
        target.world.useItemOnAll(positions, String(item), { order: orderOf(order) }, () => !owner.ended)
      )
    },

    // Walks within reach and uses the item on the block's top, like planting seeds on farmland.
    useItemOn(at: unknown, item: unknown) {
      bot()
      return moving(target.world.useItemOn(positionOf(at, 'ryksu.useItemOn'), String(item)))
    },

    // Picks up the dropped items around the bot. Resolves with how many it went for.
    collectDrops(options: { radius?: number } = {}) {
      bot()
      const owner = session()
      return moving(target.world.collectDrops(options ?? {}, () => !owner.ended))
    },

    // Everything the bot carries: [{ name, count }, …], each item once.
    inventory() {
      bot()
      return target.world.inventory()
    },

    freeSlots() {
      bot()
      return target.world.freeSlots()
    },

    // Puts items in the chest at a position. Resolves with how many went in.
    deposit(at: unknown, options: { only?: string[]; keep?: Record<string, number> } = {}) {
      bot()
      return moving(target.world.deposit(positionOf(at, 'ryksu.deposit'), options ?? {}))
    },

    // Takes items out of the chest at a position, like { wheat_seeds: 64 }. Resolves with how many it took.
    withdraw(at: unknown, items: unknown) {
      bot()
      if (!items || typeof items !== 'object')
        throw new Error('ryksu.withdraw needs items like { wheat_seeds: 64 }.')
      return moving(target.world.withdraw(positionOf(at, 'ryksu.withdraw'), items as Record<string, number>))
    },

    // Turns the script off (its stop() runs), logging why.
    exit(reason?: unknown): never {
      session().check()
      hooks.exit(reason === undefined ? null : String(reason))
      throw new ScriptStopped()
    },

    stopMoving() {
      bot()
      target.stopMoving()
    },

    // Holds sneak, through walking too, until sneak(false) or the script turns off.
    sneak(on: unknown = true) {
      bot()
      target.sneak(Boolean(on))
    },

    position,

    vitals() {
      const current = bot()
      return { health: current.health, food: current.food }
    },

    // Every automatic feature: { autoEat: { on, yours }, … }. `on` is whether it runs now, `yours` what the
    // user picked (which applies again once the script stops).
    toggles() {
      session().check()
      return target.toggles()
    },

    // Turns an automatic feature on or off while the script runs.
    setToggle(name: unknown, on: unknown) {
      session().check()
      if (!isAutomation(name)) {
        throw new Error(`Unknown toggle "${String(name)}". Toggles: ${AUTOMATIONS.join(', ')}.`)
      }
      target.setToggle(name, Boolean(on))
    },

    // Swaps the game view for a screen about the script, until showWorld() or the script turns off.
    hideWorld() {
      session().check()
      hooks.hideWorld(true)
    },

    showWorld() {
      session().check()
      hooks.hideWorld(false)
    },

    // A desktop notification, also written to the log.
    notify(text: unknown) {
      session().check()
      hooks.notify(String(text))
    },

    // What the script is doing, shown next to it in the app.
    status(text: unknown) {
      session().check()
      hooks.status(String(text))
    },

    log(...parts: unknown[]) {
      // Code still running after its run ended (a catch after a turn-off) has nothing more to say.
      if (session().ended) return
      hooks.log('info', parts.map(describe).join(' '))
    },
  }
}

export type ScriptApi = ReturnType<typeof createScriptApi>
