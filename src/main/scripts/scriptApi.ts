import type { Bot } from 'mineflayer'
import { AUTOMATIONS, isAutomation, type Automation } from '../bot/automation'
import type { Vec3Like } from '../../shared/ipc'

// What the app gives scripts to drive the bot with (BotManager provides it).
export type ScriptTarget = {
  getBot(): Bot | null
  chat(text: string): void
  goto(position: Vec3Like, range: number): Promise<void>
  stopMoving(): void
  // Each automatic feature: whether it's on now, and what the user picked for it.
  toggles(): Record<Automation, { on: boolean; yours: boolean }>
  setToggle(feature: Automation, on: boolean): void
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

type Hooks = {
  log: (level: 'info' | 'error', text: string) => void
  status: (text: string) => void
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

// The `ryksu` object scripts call. `session` is the run in progress: start()'s, then stop()'s.
export const createScriptApi = (target: ScriptTarget, session: () => Session, hooks: Hooks) => {
  const bot = () => {
    session().check()
    const current = target.getBot()
    if (!current?.entity) throw new Error('The bot is not in the world.')
    return current
  }
  const position = () => {
    const { x, y, z } = bot().entity.position
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100 }
  }
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
      const handle = (text: string, where: string) => {
        if (where === 'game_info') return
        Promise.resolve()
          .then(() => handler(text))
          .catch((error) => {
            if (!(error instanceof ScriptStopped))
              hooks.log('error', `onChat: ${(error as Error)?.message ?? error}`)
          })
      }
      current.on('messagestr', handle)
      const remove = () => current.removeListener('messagestr', handle)
      const forget = session().onEnd(remove)
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
            if (current.entity.position.distanceTo(from) >= TELEPORT_MIN_DISTANCE) resolve(position())
          }
          const spawned = () => resolve(position())
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
      const { x, y, z } = (to ?? {}) as Partial<Vec3Like>
      if (![x, y, z].every((value) => Number.isFinite(value))) {
        throw new Error('ryksu.goto needs a position like { x: 0, y: 64, z: 0 }.')
      }
      return session().wait<void>((resolve, reject) => {
        target.goto({ x: x!, y: y!, z: z! }, Math.max(0, Number(range) || 0)).then(resolve, reject)
        return () => target.stopMoving()
      })
    },

    stopMoving() {
      bot()
      target.stopMoving()
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

    // What the script is doing, shown next to it in the app.
    status(text: unknown) {
      session().check()
      hooks.status(String(text))
    },

    log(...parts: unknown[]) {
      hooks.log('info', parts.map(describe).join(' '))
    },
  }
}

export type ScriptApi = ReturnType<typeof createScriptApi>
