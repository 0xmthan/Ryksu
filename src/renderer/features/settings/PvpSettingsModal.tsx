import React, { useEffect, useState } from 'react'
import type { PvpOptions } from '../../../shared/types'

type PvpSettingsModalProps = {
  options: PvpOptions
  onClose: () => void
  onSave: (settings: Pick<PvpOptions, 'mobMovementEnabled'>) => void
}

const PvpSettingsModal: React.FC<PvpSettingsModalProps> = ({ options, onClose, onSave }) => {
  const [mobMovementEnabled, setMobMovementEnabled] = useState(options.mobMovementEnabled)

  useEffect(() => {
    setMobMovementEnabled(options.mobMovementEnabled)
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
    onSave({ mobMovementEnabled })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pvp-settings-title"
      onClick={handleOverlayClick}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-950/90 p-5 shadow-2xl"
      >
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="pvp-settings-title" className="text-lg font-semibold text-neutral-50">
              Attack Mobs Settings
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              Adjust how the bot moves and interacts with the world while fighting mobs.
            </p>
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

        <div className="space-y-4">
          <label
            className="flex items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4
              text-sm text-neutral-200"
          >
            <input
              type="checkbox"
              checked={mobMovementEnabled}
              onChange={(event) => setMobMovementEnabled(event.target.checked)}
              className="mt-1 h-4 w-4 accent-sky-500"
            />
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                Allow Movement During Combat
              </span>
              The bot will strafe and approach mobs if this is enabled. Turn it off to make the bot stand
              still and attack only when mobs come close.
            </span>
          </label>
        </div>

        <footer className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-700 px-4 py-2 text-xs font-semibold uppercase
              tracking-[0.2em] text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]
              text-neutral-50 transition hover:bg-sky-400"
          >
            Save
          </button>
        </footer>
      </form>
    </div>
  )
}

export default PvpSettingsModal
