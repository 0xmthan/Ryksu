import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { MousePointerClick, Pickaxe, Plus, Square, LoaderCircle, X } from 'lucide-react'
import ToolbarButton from './ToolbarButton'
import type { MiningState } from '../types'

const ORE_OPTIONS = [
  { id: 'coal', label: 'Coal' },
  { id: 'copper', label: 'Copper' },
  { id: 'iron', label: 'Iron' },
  { id: 'gold', label: 'Gold' },
  { id: 'redstone', label: 'Redstone' },
  { id: 'lapis', label: 'Lapis' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'quartz', label: 'Quartz' },
  { id: 'debris', label: 'Debris' },
]

// Fired on window to put the 3D view into chest-picking mode (handled by the dashboard).
export const PICK_MINING_CHESTS_EVENT = 'ryksu:pick-mining-chests'

const STORAGE_KEY = 'ryksu.mining.ores'
const BLOCKS_STORAGE_KEY = 'ryksu.mining.blocks'
const MAX_SUGGESTIONS = 8

type MineableBlock = { name: string; displayName: string }

const loadList = (key: string, fallback: string[]): string[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (Array.isArray(stored)) {
      return stored.filter((entry) => typeof entry === 'string')
    }
  } catch {
    // fall through to the default
  }
  return fallback
}

const saveList = (key: string, value: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable; the choice just isn't remembered
  }
}

type MiningPanelProps = {
  mining: MiningState | undefined
}

const MiningPanel: React.FC<MiningPanelProps> = ({ mining }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [ores, setOres] = useState<string[]>(() => loadList(STORAGE_KEY, ['iron', 'coal']))
  const [blocks, setBlocks] = useState<string[]>(() => loadList(BLOCKS_STORAGE_KEY, []))
  const [mineableBlocks, setMineableBlocks] = useState<MineableBlock[]>([])
  const [query, setQuery] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = Boolean(mining?.active)

  useEffect(() => saveList(STORAGE_KEY, ores), [ores])
  useEffect(() => saveList(BLOCKS_STORAGE_KEY, blocks), [blocks])

  // The block list depends on the server version, so load it from the connected bot when the panel opens.
  useEffect(() => {
    if (!isOpen) return
    let current = true
    window.electronAPI.bot.getMineableBlocks().then(
      (list) => {
        if (current) setMineableBlocks(list)
      },
      () => {}
    )
    return () => {
      current = false
    }
  }, [isOpen])

  const displayNames = useMemo(
    () => new Map(mineableBlocks.map((block) => [block.name, block.displayName])),
    [mineableBlocks]
  )

  const suggestions = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return []
    return mineableBlocks
      .filter(
        (block) =>
          !blocks.includes(block.name) &&
          (block.displayName.toLowerCase().includes(term) || block.name.includes(term.replace(/\s+/g, '_')))
      )
      .slice(0, MAX_SUGGESTIONS)
  }, [query, mineableBlocks, blocks])

  const addBlock = (name: string) => {
    setBlocks((previous) => (previous.includes(name) ? previous : [...previous, name]))
    setQuery('')
  }

  const removeBlock = (name: string) => {
    setBlocks((previous) => previous.filter((block) => block !== name))
  }

  const chests = mining?.chests ?? []

  const startPickingChests = () => {
    setIsOpen(false)
    window.dispatchEvent(new Event(PICK_MINING_CHESTS_EVENT))
  }

  const removeChest = (chest: { x: number; y: number; z: number }) => {
    window.electronAPI.bot.toggleMiningChest(chest).catch(() => setError('Could not remove the chest.'))
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen])

  const toggleOre = (id: string) => {
    setOres((previous) => (previous.includes(id) ? previous.filter((ore) => ore !== id) : [...previous, id]))
  }

  const handleStart = async () => {
    setIsBusy(true)
    setError(null)
    try {
      const response = await window.electronAPI.bot.startMining({ ores, blocks })
      if (!response.ok) {
        setError(response.message ?? 'Could not start mining.')
        setIsOpen(true)
      }
    } catch {
      setError('Mining action failed. Try again.')
      setIsOpen(true)
    } finally {
      setIsBusy(false)
    }
  }

  const handleStop = async () => {
    setIsBusy(true)
    try {
      const response = await window.electronAPI.bot.stopMining()
      if (!response.ok) {
        setError('Could not stop mining.')
        setIsOpen(true)
      }
    } catch {
      setError('Mining action failed. Try again.')
      setIsOpen(true)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <>
      <ToolbarButton
        label="Auto Mine"
        description="Click to start or stop mining. Right-click to choose ores or blocks and view progress."
        active={active}
        onClick={() => {
          if (!isBusy) void (active ? handleStop() : handleStart())
        }}
        onConfigure={() => setIsOpen(true)}
      >
        {isBusy ? (
          <LoaderCircle aria-hidden="true" className="h-[18px] w-[18px] animate-spin" />
        ) : (
          <Pickaxe aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
        )}
      </ToolbarButton>
      {isOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/70 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mining-settings-title"
              onClick={(event) => {
                if (event.target === event.currentTarget) setIsOpen(false)
              }}
            >
              <section
                className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-sm
                  text-neutral-300"
              >
                <button
                  type="button"
                  autoFocus
                  onClick={() => setIsOpen(false)}
                  aria-label="Close mining options"
                  className="mb-3 ml-auto flex rounded-md p-1 text-neutral-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
                <header className="flex items-center justify-between gap-3">
                  <span
                    id="mining-settings-title"
                    className="flex items-center gap-2 font-semibold text-neutral-100"
                  >
                    <Pickaxe className="h-4 w-4 text-sky-400" />
                    Auto Mine
                  </span>
                  {active ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      disabled={isBusy}
                      className="flex items-center gap-2 rounded-full border border-red-900 bg-red-950/60 px-3
                        py-1 text-xs font-semibold text-red-200 transition hover:border-red-700
                        disabled:opacity-60"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStart}
                      disabled={isBusy || (ores.length === 0 && blocks.length === 0)}
                      className="flex items-center gap-2 rounded-full border border-sky-800 bg-sky-950/60 px-3
                        py-1 text-xs font-semibold text-sky-200 transition hover:border-sky-600
                        disabled:opacity-50"
                    >
                      {isBusy ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Pickaxe className="h-3.5 w-3.5" />
                      )}
                      Start
                    </button>
                  )}
                </header>

                <div className="mt-2 flex flex-wrap gap-1">
                  {ORE_OPTIONS.map((ore) => {
                    const selected = ores.includes(ore.id)
                    return (
                      <button
                        key={ore.id}
                        type="button"
                        onClick={() => toggleOre(ore.id)}
                        disabled={active}
                        className={`rounded-full border px-2 py-0.5 text-[0.7rem] transition
                          disabled:cursor-not-allowed ${
                            selected
                              ? 'border-sky-600 bg-sky-900/50 text-sky-100'
                              : 'border-neutral-700 bg-neutral-950/60 text-neutral-400 hover:text-neutral-200'
                          }`}
                      >
                        {ore.label}
                      </button>
                    )
                  })}
                </div>

                <div className="mt-3">
                  <label htmlFor="mining-block-search" className="text-[0.7rem] text-neutral-500">
                    Other blocks
                  </label>
                  {blocks.length > 0 ? (
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {blocks.map((name) => (
                        <li
                          key={name}
                          className="flex items-center gap-1 rounded-full border border-sky-600 bg-sky-900/50
                            py-0.5 pl-2 pr-1 text-[0.7rem] text-sky-100"
                        >
                          {displayNames.get(name) ?? name}
                          <button
                            type="button"
                            onClick={() => removeBlock(name)}
                            disabled={active}
                            aria-label={`Remove ${displayNames.get(name) ?? name}`}
                            className="rounded-full p-0.5 text-sky-300 hover:text-white
                              disabled:cursor-not-allowed"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <input
                    id="mining-block-search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && suggestions[0]) {
                        event.preventDefault()
                        addBlock(suggestions[0].name)
                      }
                    }}
                    disabled={active}
                    placeholder={mineableBlocks.length ? 'Search blocks, e.g. dirt' : 'Loading blocks…'}
                    className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950/60 px-2 py-1
                      text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-sky-600
                      focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {suggestions.length > 0 ? (
                    <ul
                      className="mt-1 max-h-40 overflow-y-auto rounded-md border border-neutral-800
                        bg-neutral-950"
                    >
                      {suggestions.map((block) => (
                        <li key={block.name}>
                          <button
                            type="button"
                            onClick={() => addBlock(block.name)}
                            className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left
                              text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white"
                          >
                            {block.displayName}
                            <Plus className="h-3 w-3 text-neutral-500" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[0.7rem] text-neutral-500">Chests</span>
                    <button
                      type="button"
                      onClick={startPickingChests}
                      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] text-amber-300
                        hover:bg-neutral-800 hover:text-amber-200"
                    >
                      <MousePointerClick className="h-3 w-3" aria-hidden="true" />
                      Pick chests
                    </button>
                  </div>
                  {chests.length > 0 ? (
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {chests.map((chest) => (
                        <li
                          key={`${chest.x},${chest.y},${chest.z}`}
                          className="flex items-center gap-1 rounded-full border border-amber-500/50
                            bg-amber-900/30 py-0.5 pl-2 pr-1 font-mono text-[0.68rem] text-amber-100"
                        >
                          {chest.x} {chest.y} {chest.z}
                          <button
                            type="button"
                            onClick={() => removeChest(chest)}
                            aria-label={`Remove the chest at ${chest.x} ${chest.y} ${chest.z}`}
                            className="rounded-full p-0.5 text-amber-300 hover:text-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[0.68rem] text-neutral-600">None picked.</p>
                  )}
                </div>

                <p className="mt-2 text-[0.68rem] leading-snug text-neutral-500">
                  Stores loot in the picked chests, nearest first. With none picked, it mines until the
                  inventory is full and sends a notification. Keeps tools, armor, food and a stack of blocks.
                </p>

                <dl className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-500">Status</dt>
                    <dd className="text-right text-neutral-100">{mining?.status ?? 'Idle'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-500">Blocks mined</dt>
                    <dd className="text-neutral-200">{mining?.mined ?? 0}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-500">Items stored</dt>
                    <dd className="text-neutral-200">{mining?.deposited ?? 0}</dd>
                  </div>
                </dl>
                {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

export default MiningPanel
