import React, { useEffect, useState } from 'react'
import { Bed, LoaderCircle, MapPin, Sun } from 'lucide-react'

type SleepButtonProps = {
  isSleeping: boolean
  canSleep: boolean
  bedPickupPending: boolean
}

type Feedback = { text: string; isError: boolean }

const SleepButton: React.FC<SleepButtonProps> = ({ isSleeping, canSleep, bedPickupPending }) => {
  const [isBusy, setIsBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    if (!feedback) {
      return
    }
    const timeout = setTimeout(() => setFeedback(null), 5000)
    return () => clearTimeout(timeout)
  }, [feedback])

  const handleClick = async () => {
    setIsBusy(true)
    setFeedback(null)
    try {
      const response = await window.electronAPI.bot.useBed()
      if (response.ok) {
        // Sleeping/waking is already visible on the button itself.
        if (!response.sleeping && !isSleeping) {
          setFeedback({ text: response.message ?? 'Done.', isError: false })
        }
      } else {
        setFeedback({ text: response.message ?? 'Could not use the bed.', isError: true })
      }
    } finally {
      setIsBusy(false)
    }
  }

  const handlePickUp = async () => {
    setIsBusy(true)
    setFeedback(null)
    try {
      const response = await window.electronAPI.bot.pickUpBed()
      setFeedback({
        text: response.message ?? (response.ok ? 'Picked up the bed.' : 'Could not pick up the bed.'),
        isError: !response.ok,
      })
    } finally {
      setIsBusy(false)
    }
  }

  const label = isSleeping ? 'Wake Up' : canSleep ? 'Sleep' : 'Set Spawn'
  const busyLabel = isSleeping ? 'Waking…' : bedPickupPending ? 'Picking up…' : 'Going to bed…'
  const Icon = isBusy ? LoaderCircle : isSleeping ? Sun : canSleep ? Bed : MapPin

  return (
    <div className="flex items-center gap-2">
      {bedPickupPending && !isBusy && !isSleeping ? (
        <span className="text-xs text-neutral-300">
          Pick up the bed?{' '}
          <button
            type="button"
            onClick={handlePickUp}
            className="font-semibold text-sky-400 transition hover:text-sky-300"
          >
            Yes
          </button>
          <span className="text-neutral-600"> · </span>
          <button
            type="button"
            onClick={() => window.electronAPI.bot.dismissBedPickup()}
            className="text-neutral-400 transition hover:text-neutral-200"
          >
            Leave it
          </button>
        </span>
      ) : null}
      {feedback ? (
        <span className={`text-xs ${feedback.isError ? 'text-red-400' : 'text-emerald-400'}`}>
          {feedback.text}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleClick}
        disabled={isBusy}
        title={
          isSleeping
            ? 'Wake up'
            : canSleep
              ? 'Sleep in the nearest bed (also sets spawn)'
              : 'Set spawn at the nearest bed, or place its own bed if there is none'
        }
        className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4 py-2
          text-xs font-semibold text-neutral-200 transition hover:border-neutral-600 hover:text-sky-300
          focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-sky-400
          disabled:text-neutral-500"
      >
        <Icon className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} />
        {isBusy ? busyLabel : label}
      </button>
    </div>
  )
}

export default SleepButton
