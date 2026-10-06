import React, { useEffect, useMemo, useState } from 'react'
import type { AutoEatOptions } from '../../../shared/types'

type AutoEatSettingsModalProps = {
  options: AutoEatOptions
  onClose: () => void
  onSave: (options: AutoEatOptions) => void
}

const clampNumber = (value: number, minimum: number, maximum: number) => {
  if (Number.isNaN(value)) {
    return minimum
  }
  return Math.min(Math.max(value, minimum), maximum)
}

const AutoEatSettingsModal: React.FC<AutoEatSettingsModalProps> = ({ options, onClose, onSave }) => {
  const priorityOptions = useMemo(
    () =>
      [
        { value: 'foodPoints', label: 'Food Points', hint: 'Maximizes hunger points restored.' },
        { value: 'saturation', label: 'Saturation', hint: 'Prefers food with higher saturation gain.' },
        { value: 'effectiveQuality', label: 'Effective Quality', hint: 'Balances hunger and saturation.' },
        {
          value: 'saturationRatio',
          label: 'Saturation Ratio',
          hint: 'Optimizes saturation per hunger point.',
        },
      ] satisfies Array<{ value: AutoEatOptions['priority']; label: string; hint: string }>,
    []
  )
  const [priority, setPriority] = useState(options.priority)
  const [minHunger, setMinHunger] = useState(String(options.minHunger))
  const [minHealth, setMinHealth] = useState(String(options.minHealth))
  const [returnToLastItem, setReturnToLastItem] = useState(options.returnToLastItem)
  const [offhand, setOffhand] = useState(options.offhand)
  const [eatingTimeout, setEatingTimeout] = useState(String(options.eatingTimeout))
  const [bannedFood, setBannedFood] = useState(options.bannedFood.join(', '))
  const [strictErrors, setStrictErrors] = useState(options.strictErrors)

  useEffect(() => {
    setPriority(options.priority)
    setMinHunger(String(options.minHunger))
    setMinHealth(String(options.minHealth))
    setReturnToLastItem(options.returnToLastItem)
    setOffhand(options.offhand)
    setEatingTimeout(String(options.eatingTimeout))
    setBannedFood(options.bannedFood.join(', '))
    setStrictErrors(options.strictErrors)
  }, [options])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleOverlayClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()

    const parsedMinHunger = clampNumber(Number(minHunger), 0, 20)
    const parsedMinHealth = clampNumber(Number(minHealth), 0, 20)
    const timeoutRaw = Number(eatingTimeout)
    const parsedTimeout = Number.isFinite(timeoutRaw) ? Math.max(0, timeoutRaw) : options.eatingTimeout

    const parsedBanned = bannedFood
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)

    const sanitizedPriority = priorityOptions.find((entry) => entry.value === priority)?.value ?? 'foodPoints'

    onSave({
      priority: sanitizedPriority,
      minHunger: parsedMinHunger,
      minHealth: parsedMinHealth,
      returnToLastItem,
      offhand,
      eatingTimeout: parsedTimeout,
      bannedFood: parsedBanned,
      strictErrors,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 px-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auto-eat-settings-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-3xl border border-neutral-800 bg-neutral-950/90 p-5 shadow-2xl
          max-h-[80vh] overflow-y-auto"
      >
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="auto-eat-settings-title" className="text-lg font-semibold text-neutral-50">
              Auto Eat Settings
            </h2>
            <p className="mt-1 text-sm text-neutral-400">Tune how the bot picks food and when it eats.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-neutral-700 px-3 py-1 text-xs font-semibold uppercase
              tracking-[0.2em] text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100"
          >
            Close
          </button>
        </header>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm text-neutral-200">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Priority
            </span>
            <select
              value={priority}
              onChange={(event) => {
                const nextValue =
                  priorityOptions.find((entry) => entry.value === event.target.value)?.value ?? 'foodPoints'
                setPriority(nextValue)
              }}
              className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            >
              {priorityOptions.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-neutral-500">
              {priorityOptions.find((entry) => entry.value === priority)?.hint ??
                'Choose how the bot ranks food items.'}
            </p>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-neutral-200">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                Min Hunger
              </span>
              <input
                type="number"
                min={0}
                max={20}
                value={minHunger}
                onChange={(event) => setMinHunger(event.target.value)}
                className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                  text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
              <p className="text-xs text-neutral-500">Eat whenever hunger falls at or below this number.</p>
            </label>

            <label className="flex flex-col gap-2 text-sm text-neutral-200">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                Min Health
              </span>
              <input
                type="number"
                min={0}
                max={20}
                value={minHealth}
                onChange={(event) => setMinHealth(event.target.value)}
                className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                  text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
              <p className="text-xs text-neutral-500">
                Below this health, the bot favours food with better saturation.
              </p>
            </label>
          </div>

          <label className="flex flex-col gap-2 text-sm text-neutral-200">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Eating Timeout (ms)
            </span>
            <input
              type="number"
              min={0}
              value={eatingTimeout}
              onChange={(event) => setEatingTimeout(event.target.value)}
              className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
            <p className="text-xs text-neutral-500">
              Abort eating if it takes longer than this many milliseconds.
            </p>
          </label>

          <label className="flex flex-col gap-2 text-sm text-neutral-200">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Banned Food (comma separated)
            </span>
            <textarea
              rows={3}
              value={bannedFood}
              onChange={(event) => setBannedFood(event.target.value)}
              className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
            <p className="text-xs text-neutral-500">
              Listed items are never eaten. Separate multiple entries with commas.
            </p>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={returnToLastItem}
                onChange={(event) => setReturnToLastItem(event.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
              Return To Last Item
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={offhand}
                onChange={(event) => setOffhand(event.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
              Use Offhand
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={strictErrors}
                onChange={(event) => setStrictErrors(event.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
              Strict Errors
            </label>
          </div>
        </div>

        <footer className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-300
              transition hover:border-neutral-500 hover:text-neutral-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-neutral-950 transition
              hover:bg-sky-400 focus-visible:outline focus-visible:outline-offset-2
              focus-visible:outline-sky-400"
          >
            Save
          </button>
        </footer>
      </form>
    </div>
  )
}

export default AutoEatSettingsModal
