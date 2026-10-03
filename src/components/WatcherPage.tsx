import React, { useEffect, useState } from 'react'
import { Eye, X } from 'lucide-react'
import type { WorldView } from '../types'
import Surroundings3D, { ENTITY_COLORS } from './Surroundings3D'

const LEGEND = {
  Bot: '#ffffff',
  Players: ENTITY_COLORS.player,
  Hostile: ENTITY_COLORS.hostile,
  Animals: ENTITY_COLORS.passive,
  Items: ENTITY_COLORS.item,
  Chest: '#fbbf24',
}

type WatcherPageProps = {
  blocks: WorldView['blocks'] | null
  chest: { x: number; y: number; z: number } | null
  status: string | null
  onClose: () => void
}

const WatcherPage: React.FC<WatcherPageProps> = ({ blocks, chest, status, onClose }) => {
  const [hover, setHover] = useState<string | null>(null)
  const [hideRoof, setHideRoof] = useState(true)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-x-0 bottom-0 top-12 z-40 flex flex-col bg-neutral-950">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-800 px-5 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
          <Eye className="h-4 w-4 text-sky-400" />
          Watcher
          {status ? <span className="font-normal text-neutral-400">· {status}</span> : null}
        </span>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={hideRoof}
              onChange={(event) => setHideRoof(event.target.checked)}
              className="h-3.5 w-3.5 accent-sky-500"
            />
            Hide roof
          </label>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="rounded-full p-1.5 text-neutral-400 transition hover:bg-neutral-800
              hover:text-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <Surroundings3D
          blocks={blocks}
          chest={chest}
          hideRoof={hideRoof}
          onHover={setHover}
          className="h-full w-full"
        />
        <div
          className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-wrap items-end justify-between
            gap-3 text-xs"
        >
          <span className="rounded-md bg-neutral-950/80 px-2.5 py-1.5 text-neutral-200">
            {hover ??
              (blocks
                ? 'Drag to orbit, scroll to zoom, right-drag to pan. Hover to see what something is.'
                : 'Waiting for the bot to spawn…')}
          </span>
          <span className="flex flex-wrap gap-3 rounded-md bg-neutral-950/80 px-2.5 py-1.5 text-neutral-400">
            {Object.entries(LEGEND).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}

export default WatcherPage
