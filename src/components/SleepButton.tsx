import React, { useEffect, useState } from 'react'
import { Bed, LoaderCircle, MapPin, Sun } from 'lucide-react'

type SleepButtonProps = {
  isSleeping: boolean
  canSleep: boolean
  bedPickupPending: boolean
}

type Feedback = { text: string; isError: boolean }

// Beds work from this tick of the day (or in a thunderstorm), the same window the bot checks.
const NIGHT_STARTS = 12541
const TICKS_PER_DAY = 24000

// Real time until night at 20 ticks a second, like "4m 12s".
const untilNight = (timeOfDay: number) => {
  const ticks = (NIGHT_STARTS - timeOfDay + TICKS_PER_DAY) % TICKS_PER_DAY
  const seconds = Math.ceil(ticks / 20)
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

const SleepButton: React.FC<SleepButtonProps> = ({ isSleeping, canSleep, bedPickupPending }) => {
  const [isBusy, setIsBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('Going to bed…')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const tooltipId = React.useId()
  // The time of day, from the watcher's updates, for the countdown to night.
  const [timeOfDay, setTimeOfDay] = useState<number | null>(null)
  useEffect(() => {
    if (canSleep) return
    return window.electronAPI.bot.onMotion((motion) => setTimeOfDay(motion.time))
  }, [canSleep])

  useEffect(() => {
    if (!feedback) return
    const timeout = setTimeout(() => setFeedback(null), 5000)
    return () => clearTimeout(timeout)
  }, [feedback])

  const handleAction = async (pickup = false) => {
    setIsBusy(true)
    setBusyLabel(pickup ? 'Picking up…' : isSleeping ? 'Waking…' : canSleep ? 'Going to bed…' : 'Setting spawn…')
    setFeedback(null)
    try {
      const response = pickup
        ? await window.electronAPI.bot.pickUpBed()
        : await window.electronAPI.bot.useBed()
      setFeedback({
        text: response.message ?? (response.ok ? 'Done.' : 'Could not use bed.'),
        isError: !response.ok,
      })
    } catch {
      setFeedback({ text: 'Bed action failed. Try again.', isError: true })
    } finally {
      setIsBusy(false)
    }
  }

  const label = isSleeping ? 'Wake Up' : canSleep ? 'Sleep' : 'Set Spawn'
  const description = isSleeping ? 'Click to wake up.' : canSleep
    ? 'Sleep in the nearest bed and set spawn.'
    : 'Set spawn at a nearby bed, or place your own.'
  const Icon = isBusy ? LoaderCircle : isSleeping ? Sun : canSleep ? Bed : MapPin
  const offerPickup = bedPickupPending && !isBusy && !isSleeping
  const expanded = isBusy || Boolean(feedback) || offerPickup

  return (
    <div className="group relative flex h-8 shrink-0 items-center rounded-full border border-neutral-700/60 bg-neutral-900/70 transition hover:border-sky-400/70">
      <button
        type="button"
        onClick={() => handleAction()}
        disabled={isBusy}
        aria-label={label}
        aria-describedby={expanded ? undefined : tooltipId}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition
          hover:bg-sky-500/20 hover:text-sky-100 hover:shadow-[0_0_12px_rgba(56,189,248,0.15)]
          focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-sky-400
          disabled:cursor-wait ${isSleeping ? 'text-sky-300' : 'text-neutral-300'}`}
      >
        <Icon aria-hidden="true" className={`h-[18px] w-[18px] ${isBusy ? 'animate-spin' : ''}`} strokeWidth={1.75} />
      </button>
      <div className={`overflow-hidden transition-[max-width,opacity] duration-200 motion-reduce:transition-none
        ${expanded ? 'max-w-52 opacity-100' : 'max-w-0 opacity-0'}`}>
        <div className="flex items-center gap-2 whitespace-nowrap pr-3 text-xs">
          {offerPickup ? (
            <>
              <span className="text-neutral-300">Pick up bed?</span>
              <button type="button" onClick={() => handleAction(true)} className="text-sky-300 hover:text-white">Yes</button>
              <button type="button" onClick={() => window.electronAPI.bot.dismissBedPickup()} className="text-neutral-400 hover:text-white">Leave</button>
            </>
          ) : (
            <span role="status" title={feedback?.text} className={`truncate ${feedback?.isError ? 'text-rose-300' : 'text-neutral-200'}`}>
              {isBusy ? busyLabel : feedback?.text}
            </span>
          )}
        </div>
      </div>
      {!expanded ? (
        <div id={tooltipId} role="tooltip" className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-52
          rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-xs text-neutral-400 shadow-xl
          opacity-0 transition group-hover:opacity-100 group-has-[:focus-visible]:opacity-100">
          <span className="mb-1 block font-semibold text-neutral-100">{label}</span>
          {description}
          {!canSleep && !isSleeping && timeOfDay !== null ? (
            <span className="mt-2 flex items-center justify-between border-t border-neutral-800 pt-2">
              <span>Night in</span>
              <span className="font-mono text-sky-300">{untilNight(timeOfDay)}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default SleepButton
