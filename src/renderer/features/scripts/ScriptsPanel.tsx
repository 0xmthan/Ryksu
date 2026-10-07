import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Play,
  ScrollText,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import ToolbarButton from '../../components/ui/ToolbarButton'
import CodeEditor from './CodeEditor'
import { SCRIPT_CALLS } from '../../../shared/scriptApi'
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

type Draft = { name: string; code: string }

// Whether the side column (help and log) and the help in it are open, remembered between launches.
const SIDE_STORAGE_KEY = 'ryksu.scripts.sideOpen'
const HELP_STORAGE_KEY = 'ryksu.scripts.helpOpen'

const loadOpen = (key: string) => {
  try {
    return localStorage.getItem(key) !== 'false'
  } catch {
    return true
  }
}

const saveOpen = (key: string, open: boolean) => {
  try {
    localStorage.setItem(key, String(open))
  } catch {
    // storage unavailable; the choice just isn't remembered
  }
}

const ScriptsPanel: React.FC = () => {
  const { scripts, running, log } = useScripts()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Unsaved edits by script id; they last while the app is open, even with the panel closed.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sideOpen, setSideOpen] = useState(() => loadOpen(SIDE_STORAGE_KEY))
  const [helpOpen, setHelpOpen] = useState(() => loadOpen(HELP_STORAGE_KEY))

  const toggleSide = () => {
    saveOpen(SIDE_STORAGE_KEY, !sideOpen)
    setSideOpen(!sideOpen)
  }

  const toggleHelp = () => {
    saveOpen(HELP_STORAGE_KEY, !helpOpen)
    setHelpOpen(!helpOpen)
  }

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

  // Drops the unsaved edits, back to the saved script.
  const discard = (script: Script) => {
    setDrafts(({ [script.id]: _discarded, ...rest }) => rest)
    setError(null)
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
    // Once it's on, the panel gets out of the way (the side panel shows the script); if it didn't start, the
    // panel stays open with the reason.
    if ((await save(script)) && (await act(() => window.electronAPI.scripts.start(script.id)))) {
      setIsOpen(false)
    }
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
                    onClick={toggleSide}
                    aria-pressed={sideOpen}
                    aria-label={sideOpen ? 'Hide help and log' : 'Show help and log'}
                    title={sideOpen ? 'Hide help and log' : 'Show help and log'}
                    className="rounded-md p-1 text-neutral-400 hover:text-white"
                  >
                    {sideOpen ? (
                      <PanelRightClose className="h-4 w-4" />
                    ) : (
                      <PanelRightOpen className="h-4 w-4" />
                    )}
                  </button>
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
                        {isDirty(selected) ? (
                          <button
                            type="button"
                            onClick={() => discard(selected)}
                            disabled={busy}
                            className="rounded-md px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-100
                              disabled:opacity-40"
                          >
                            Discard
                          </button>
                        ) : null}
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

                  {sideOpen ? (
                    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-l border-neutral-800">
                      <button
                        type="button"
                        onClick={toggleHelp}
                        aria-expanded={helpOpen}
                        aria-controls="scripts-help"
                        className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-xs
                          font-semibold text-neutral-400 hover:text-neutral-200"
                      >
                        What scripts can call
                        <ChevronDown
                          aria-hidden="true"
                          className={`h-3.5 w-3.5 transition-transform ${helpOpen ? '' : '-rotate-90'}`}
                        />
                      </button>
                      {helpOpen ? (
                        <dl
                          id="scripts-help"
                          className="max-h-[55%] shrink-0 space-y-1.5 overflow-y-auto px-3 pb-2
                            text-[0.68rem]"
                        >
                          {SCRIPT_CALLS.map((call) => (
                            <div key={call.name}>
                              <dt className="font-mono text-sky-200">
                                {call.waits ? 'await ' : ''}ryksu.{call.signature}
                              </dt>
                              <dd className="text-neutral-500">{call.doc}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      <h3
                        className="shrink-0 border-t border-neutral-800 px-3 pt-2 text-xs font-semibold
                          text-neutral-400"
                      >
                        Log
                      </h3>
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
                  ) : null}
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
