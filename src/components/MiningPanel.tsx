import React, { useEffect, useState } from 'react'
import { Pickaxe, Square, LoaderCircle } from 'lucide-react'
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

const STORAGE_KEY = 'ryksu.mining.ores'

const loadOres = (): string[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (Array.isArray(stored)) {
      return stored.filter((ore) => typeof ore === 'string')
    }
  } catch {
    // fall through to the default
  }
  return ['iron', 'coal']
}

type MiningPanelProps = {
  mining: MiningState | undefined
}

const MiningPanel: React.FC<MiningPanelProps> = ({ mining }) => {
  const [ores, setOres] = useState<string[]>(loadOres)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = Boolean(mining?.active)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ores))
    } catch {
      // storage unavailable; the choice just isn't remembered
    }
  }, [ores])

  const toggleOre = (id: string) => {
    setOres((previous) => (previous.includes(id) ? previous.filter((ore) => ore !== id) : [...previous, id]))
  }

  const handleStart = async () => {
    setIsBusy(true)
    setError(null)
    try {
      const response = await window.electronAPI.bot.startMining({ ores })
      if (!response.ok) {
        setError(response.message ?? 'Could not start mining.')
      }
    } finally {
      setIsBusy(false)
    }
  }

  const handleStop = async () => {
    setIsBusy(true)
    try {
      await window.electronAPI.bot.stopMining()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/90 p-3 text-sm text-neutral-300">
      <header className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-semibold text-neutral-100">
          <Pickaxe className="h-4 w-4 text-sky-400" />
          Auto Mine
        </span>
        {active ? (
          <button
            type="button"
            onClick={handleStop}
            disabled={isBusy}
            className="flex items-center gap-2 rounded-full border border-red-900 bg-red-950/60 px-3 py-1
              text-xs font-semibold text-red-200 transition hover:border-red-700 disabled:opacity-60"
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={isBusy || ores.length === 0}
            className="flex items-center gap-2 rounded-full border border-sky-800 bg-sky-950/60 px-3 py-1
              text-xs font-semibold text-sky-200 transition hover:border-sky-600 disabled:opacity-50"
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
              className={`rounded-full border px-2 py-0.5 text-[0.7rem] transition disabled:cursor-not-allowed
              ${
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

      <p className="mt-2 text-[0.68rem] leading-snug text-neutral-500">
        Stores loot in the chest nearest the bot at Start. Keeps tools, armor, food and a stack of blocks.
      </p>

      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-neutral-500">Status</dt>
          <dd className="text-right text-neutral-100">{mining?.status ?? 'Idle'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-neutral-500">Chest</dt>
          <dd className="font-mono text-neutral-200">
            {mining?.chest ? `${mining.chest.x} / ${mining.chest.y} / ${mining.chest.z}` : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-neutral-500">Ores mined</dt>
          <dd className="text-neutral-200">{mining?.mined ?? 0}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-neutral-500">Items stored</dt>
          <dd className="text-neutral-200">{mining?.deposited ?? 0}</dd>
        </div>
      </dl>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </section>
  )
}

export default MiningPanel
