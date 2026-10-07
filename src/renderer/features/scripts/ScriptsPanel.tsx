import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { LoaderCircle, Plus, Play, ScrollText, Square, Trash2, X } from 'lucide-react'
import ToolbarButton from '../../components/ui/ToolbarButton'
import CodeEditor from './CodeEditor'
import type { Script } from '../../../shared/types'
import { useScripts } from './useScripts'

const NEW_SCRIPT_CODE = `// Runs when you turn the script on.
async function start() {
  ryksu.status('Running')
}

// Runs when you turn it off (optional).
async function stop() {
}
`

const API_HELP: [string, string][] = [
  ['ryksu.chat(text)', 'Say something or run a command, like "/wp home".'],
  ['await ryksu.wait(ms)', 'Pause for a while.'],
  ['await ryksu.waitForTeleport()', 'Until the server teleports the bot (15s at most).'],
  ['await ryksu.waitForChat(text)', 'Until a server message contains the text (or matches a /regex/).'],
  ['ryksu.onChat((text) => …)', 'Runs for every server message while the script is on.'],
  ['await ryksu.goto({ x, y, z })', 'Walk there.'],
  ['ryksu.position(), ryksu.vitals()', 'Where the bot is; its health and food.'],
  ['ryksu.toggles()', 'Each automatic feature: { on, yours }, on now and what you picked.'],
  ['ryksu.setToggle(name, on)', 'Turn an automatic feature on or off while the script runs.'],
  ['ryksu.status(text), ryksu.log(…)', 'Show what the script is doing; write to the log.'],
]

type Draft = { name: string; code: string }

const ScriptsPanel: React.FC = () => {
  const { scripts, running, log } = useScripts()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Unsaved edits by script id; they last while the app is open, even with the panel closed.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = scripts.find((script) => script.id === selectedId) ?? scripts[0] ?? null
  const draftOf = (script: Script): Draft => drafts[script.id] ?? { name: script.name, code: script.code }
  const isDirty = (script: Script) => {
    const draft = drafts[script.id]
    return Boolean(draft) && (draft.name !== script.name || draft.code !== script.code)
  }
  const draft = selected ? draftOf(selected) : null

  const edit = (patch: Partial<Draft>) => {
    if (!selected || !draft) return
    setDrafts((previous) => ({ ...previous, [selected.id]: { ...draft, ...patch } }))
  }

  // Runs an action with the buttons disabled, showing what went wrong.
  const act = async (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) setError(result.message ?? 'That did not work.')
      return result.ok
    } catch {
      setError('That did not work. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async (script: Script) => {
    if (!isDirty(script)) return true
    const ok = await act(() => window.electronAPI.scripts.save({ id: script.id, ...draftOf(script) }))
    if (ok) {
      setDrafts(({ [script.id]: _saved, ...rest }) => rest)
    }
    return ok
  }

  const create = () =>
    act(async () => {
      const result = await window.electronAPI.scripts.save({ name: 'New script', code: NEW_SCRIPT_CODE })
      if (result.script) setSelectedId(result.script.id)
      return result
    })

  const remove = (script: Script) => {
    if (!window.confirm(`Delete "${script.name}"?`)) return
    void act(async () => {
      const result = await window.electronAPI.scripts.delete(script.id)
      if (result.ok) setDrafts(({ [script.id]: _deleted, ...rest }) => rest)
      return result
    })
  }

  // Saves unsaved edits first, so what runs is what's on screen.
  const toggle = async (script: Script) => {
    if (running?.id === script.id) {
      await act(() => window.electronAPI.scripts.stop())
      return
    }
    if (await save(script)) await act(() => window.electronAPI.scripts.start(script.id))
  }

  return (
    <>
      <ToolbarButton
        label="Scripts"
        description="Your scripts. Click to open them. While one is on, the automatic features are paused."
        active={Boolean(running)}
        onClick={() => setIsOpen(true)}
      >
        <ScrollText aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={1.75} />
      </ToolbarButton>
      {isOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-60 flex items-center justify-center bg-neutral-950/70 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="scripts-title"
              onClick={(event) => {
                if (event.target === event.currentTarget) setIsOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setIsOpen(false)
              }}
            >
              <section
                className="flex h-[min(44rem,90vh)] w-full max-w-5xl flex-col rounded-xl border
                  border-neutral-800 bg-neutral-900 text-sm text-neutral-300"
              >
                <header
                  className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3"
                >
                  <span id="scripts-title" className="flex items-center gap-2 font-semibold text-neutral-100">
                    <ScrollText className="h-4 w-4 text-sky-400" />
                    Scripts
                  </span>
                  <span className="mr-auto text-xs text-neutral-500">
                    One runs at a time. While it&apos;s on, the automatic features are paused.
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    aria-label="Close scripts"
                    className="rounded-md p-1 text-neutral-400 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>

                <div className="flex min-h-0 flex-1">
                  <nav className="flex w-56 shrink-0 flex-col border-r border-neutral-800">
                    <ul className="min-h-0 flex-1 overflow-y-auto p-2">
                      {scripts.map((script) => {
                        const on = running?.id === script.id
                        return (
                          <li key={script.id}>
                            <div
                              className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${
                                script.id === selected?.id ? 'bg-neutral-800' : 'hover:bg-neutral-800/50'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedId(script.id)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <span className="block truncate text-neutral-100">
                                  {draftOf(script).name}
                                  {isDirty(script) ? <span className="text-amber-400"> •</span> : null}
                                </span>
                                {on ? (
                                  <span className="block truncate text-[0.68rem] text-emerald-400">
                                    {running.status}
                                  </span>
                                ) : null}
                              </button>
                              <button
                                type="button"
                                onClick={() => void toggle(script)}
                                disabled={busy}
                                aria-label={on ? `Turn off ${script.name}` : `Turn on ${script.name}`}
                                className={`rounded-full border p-1 transition disabled:opacity-50 ${
                                  on
                                    ? 'border-red-900 bg-red-950/60 text-red-200 hover:border-red-700'
                                    : `border-neutral-700 text-neutral-400 hover:border-sky-600
                                      hover:text-sky-200`
                                  }`}
                              >
                                {on ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                    <button
                      type="button"
                      onClick={() => void create()}
                      disabled={busy}
                      className="m-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed
                        border-neutral-700 py-1.5 text-xs text-neutral-400 hover:border-sky-600
                        hover:text-sky-200 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New script
                    </button>
                  </nav>

                  {selected && draft ? (
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
                        <input
                          value={draft.name}
                          onChange={(event) => edit({ name: event.target.value })}
                          aria-label="Script name"
                          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5
                            py-0.5 font-semibold text-neutral-100 hover:border-neutral-700
                            focus:border-sky-600 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void save(selected)}
                          disabled={busy || !isDirty(selected)}
                          className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200
                            hover:border-sky-600 disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggle(selected)}
                          disabled={busy}
                          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs
                            font-semibold disabled:opacity-50 ${
                              running?.id === selected.id
                                ? 'border-red-900 bg-red-950/60 text-red-200 hover:border-red-700'
                                : 'border-sky-800 bg-sky-950/60 text-sky-200 hover:border-sky-600'
                            }`}
                        >
                          {busy ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          ) : running?.id === selected.id ? (
                            <Square className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          {running?.id === selected.id ? 'Turn off' : 'Turn on'}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(selected)}
                          disabled={busy}
                          aria-label={`Delete ${selected.name}`}
                          className="rounded-md p-1.5 text-neutral-500 hover:text-red-300 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <CodeEditor
                        value={draft.code}
                        onChange={(code) => edit({ code })}
                        onSave={() => void save(selected)}
                        label="Script code"
                      />
                      {error ? (
                        <p className="border-t border-neutral-800 px-3 py-1.5 text-xs text-red-400">
                          {error}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="m-auto text-xs text-neutral-500">No scripts yet.</p>
                  )}

                  <aside className="flex w-72 shrink-0 flex-col border-l border-neutral-800">
                    <details className="border-b border-neutral-800 px-3 py-2" open>
                      <summary className="cursor-pointer text-xs font-semibold text-neutral-400">
                        What scripts can call
                      </summary>
                      <dl className="mt-2 space-y-1.5 text-[0.68rem]">
                        {API_HELP.map(([call, meaning]) => (
                          <div key={call}>
                            <dt className="font-mono text-sky-200">{call}</dt>
                            <dd className="text-neutral-500">{meaning}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                    <h3 className="px-3 pt-2 text-xs font-semibold text-neutral-400">Log</h3>
                    <ol className="min-h-0 flex-1 overflow-y-auto px-3 py-1 font-mono text-[0.68rem]">
                      {log.length === 0 ? <li className="text-neutral-600">Nothing yet.</li> : null}
                      {log
                        .slice()
                        .reverse()
                        .map((entry, index) => (
                          <li
                            key={`${entry.at}-${index}`}
                            className={entry.level === 'error' ? 'text-red-300' : 'text-neutral-400'}
                          >
                            <span className="text-neutral-600">
                              {new Date(entry.at).toLocaleTimeString([], { hour12: false })}{' '}
                            </span>
                            {entry.text}
                          </li>
                        ))}
                    </ol>
                  </aside>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

export default ScriptsPanel
