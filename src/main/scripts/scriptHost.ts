import { AsyncLocalStorage } from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import type { Script, ScriptLogEntry, ScriptsState } from '../../shared/types'
import { createScriptApi, ScriptStopped, Session, type ScriptTarget, type SessionScope } from './scriptApi'
import { fileScriptStore, type ScriptStore } from './scriptStore'
import type { Automation } from '../bot/automation'

// How long a script's top level may run when it loads (an endless loop there would freeze the app).
const LOAD_TIMEOUT_MS = 1000
// How long stop() gets before the script is turned off anyway.
const STOP_TIMEOUT_MS = 30_000
const LOG_LIMIT = 200

type Run = {
  script: Script
  // start()'s, then stop()'s once it's turned off.
  session: Session
  stopSession: Session | null
  status: string
  worldHidden: boolean
  stopFn: (() => unknown) | null
  // Set while stop() runs, so a second turn-off waits for the same one.
  stopping: Promise<void> | null
}

const messageOf = (error: unknown) => (error as Error | undefined)?.message || String(error)

// Which run of a script (start() or stop()) a call comes from, carried through its awaits, so start() code
// still going after a turn-off can't act through stop()'s session.
const sessions = new AsyncLocalStorage<Session>()
const ended = new Session()
ended.end()
const scope: SessionScope = {
  current: () => sessions.getStore() ?? ended,
  run: (session, action) => sessions.run(session, action),
}

// Runs the user's scripts, one at a time. While one is on, the target pauses the automatic features (see
// src/main/bot/automation.ts). Scripts run in their own context with only `ryksu` and `console` to call;
// that keeps them tidy, but it's not a security boundary, so it's for the user's own scripts.
export class ScriptHost extends EventEmitter<{ state: [state: ScriptsState] }> {
  private target: ScriptTarget & { pauseAutomation(): void; resumeAutomation(): void }
  private store: ScriptStore
  private scripts: Script[]
  private run: Run | null = null
  private log: ScriptLogEntry[] = []

  constructor({
    target,
    store = fileScriptStore,
  }: {
    target: ScriptTarget & { pauseAutomation(): void; resumeAutomation(): void }
    store?: ScriptStore
  }) {
    super()
    this.target = target
    this.store = store
    this.scripts = store.load()
  }

  getState(): ScriptsState {
    return {
      scripts: this.scripts.map((script) => ({ ...script })),
      running: this.run
        ? {
            id: this.run.script.id,
            status: this.run.status,
            worldHidden: this.run.worldHidden,
            toggles: Object.fromEntries(
              Object.entries(this.target.toggles()).map(([feature, { on }]) => [feature, on])
            ) as Record<Automation, boolean>,
          }
        : null,
      log: [...this.log],
    }
  }

  get running() {
    return this.run !== null
  }

  // Adds a script, or updates the one with the same id. A running script picks up changes next time it starts.
  save(input: unknown): Script {
    const { id, name, code } = (input ?? {}) as Partial<Record<keyof Script, unknown>>
    const script: Script = {
      id: typeof id === 'string' && id ? id : `script-${Date.now().toString(36)}`,
      name: (typeof name === 'string' && name.trim()) || 'Untitled script',
      code: typeof code === 'string' ? code : '',
    }
    const index = this.scripts.findIndex((existing) => existing.id === script.id)
    if (index >= 0) this.scripts[index] = script
    else this.scripts.push(script)
    this._persist()
    return { ...script }
  }

  async remove(id: unknown) {
    if (this.run?.script.id === id) await this.stop()
    this.scripts = this.scripts.filter((script) => script.id !== id)
    this._persist()
  }

  // Turns a script on (turning off the one that's on first).
  async start(id: unknown) {
    const script = this.scripts.find((candidate) => candidate.id === id)
    if (!script) throw new Error('That script is gone.')
    if (this.run && this.run.script.id === id && !this.run.stopping) return
    await this.stop()
    if (!this.target.getBot()?.entity) throw new Error('Connect the bot first.')

    const run: Run = {
      script,
      session: new Session(),
      stopSession: null,
      status: 'Starting…',
      worldHidden: false,
      stopFn: null,
      stopping: null,
    }
    // A script turning a feature on or off shows on the toolbar.
    const target: ScriptTarget = {
      ...this.target,
      setToggle: (feature, on) => {
        this.target.setToggle(feature, on)
        this._emit()
      },
    }
    const api = createScriptApi(target, scope, {
      log: (level, text) => this._log(level, `${script.name}: ${text}`),
      status: (text) => {
        if (this.run !== run) return
        run.status = text
        this._emit()
      },
      notify: (text) => {
        this._log('info', `${script.name}: ${text}`)
        this.target.notify(script.name, text)
      },
      exit: (reason) => {
        if (this.run !== run) return
        if (reason) this._log('info', `${script.name}: ${reason}`)
        void this.stop()
      },
      hideWorld: (hidden) => {
        if (this.run !== run || run.worldHidden === hidden) return
        run.worldHidden = hidden
        this._emit()
      },
    })

    let startFn: () => unknown
    try {
      const context = vm.createContext({
        ryksu: api,
        console: {
          log: api.log,
          info: api.log,
          warn: api.log,
          error: (...parts: unknown[]) =>
            this._log('error', `${script.name}: ${parts.map(String).join(' ')}`),
        },
      })
      sessions.run(run.session, () =>
        new vm.Script(script.code, { filename: `${script.name}.js` }).runInContext(context, {
          timeout: LOAD_TIMEOUT_MS,
        })
      )
      if (typeof context.start !== 'function') throw new Error('It needs an `async function start()`.')
      startFn = context.start
      run.stopFn = typeof context.stop === 'function' ? context.stop : null
    } catch (error) {
      this._log('error', `${script.name} didn't load: ${messageOf(error)}`)
      this._emit()
      throw new Error(`${script.name} didn't load: ${messageOf(error)}`)
    }

    this.run = run
    this.target.pauseAutomation()
    this._log('info', `Turned on ${script.name}.`)
    this._emit()

    Promise.resolve()
      .then(() => sessions.run(run.session, () => startFn()))
      .then(
        () => {
          if (this.run === run && run.status === 'Starting…') {
            run.status = 'On'
            this._emit()
          }
        },
        (error) => {
          if (this.run !== run || run.session.ended || error instanceof ScriptStopped) return
          // It failed partway, so it ends here without stop().
          this._log('error', `${script.name} stopped with an error: ${messageOf(error)}`)
          this._finish(run)
        }
      )
  }

  // Turns the running script off: its pending calls stop, then its stop() runs.
  stop() {
    const run = this.run
    if (!run) return Promise.resolve()
    run.stopping ??= this._stop(run)
    return run.stopping
  }

  // The bot left the world: the script ends without stop(), which would have nothing to drive.
  end(reason: string) {
    const run = this.run
    if (!run) return
    this._log('info', `${run.script.name} turned off: ${reason}`)
    this._finish(run)
  }

  private async _stop(run: Run) {
    run.session.end()
    if (run.stopFn && this.target.getBot()?.entity) {
      const stopSession = new Session()
      run.stopSession = stopSession
      run.status = 'Stopping…'
      this._emit()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.resolve().then(() => sessions.run(stopSession, () => run.stopFn!())),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`stop() took over ${STOP_TIMEOUT_MS / 1000}s.`)),
              STOP_TIMEOUT_MS
            )
          }),
        ])
      } catch (error) {
        if (!(error instanceof ScriptStopped))
          this._log('error', `${run.script.name}'s stop(): ${messageOf(error)}`)
      } finally {
        clearTimeout(timer)
      }
    }
    if (this.run !== run) return
    this._log('info', `Turned off ${run.script.name}.`)
    this._finish(run)
  }

  private _finish(run: Run) {
    run.session.end()
    run.stopSession?.end()
    if (this.run !== run) return
    this.run = null
    this.target.resumeAutomation()
    this._emit()
  }

  private _log(level: ScriptLogEntry['level'], text: string) {
    this.log.push({ at: Date.now(), level, text })
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT)
    this._emit()
  }

  private _persist() {
    this.store.save(this.scripts.map((script) => ({ ...script })))
    this._emit()
  }

  private _emit() {
    this.emit('state', this.getState())
  }
}
