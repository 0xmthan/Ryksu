import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { WorldView } from '../types'
import Surroundings3D from './Surroundings3D'

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
      <div className="relative min-h-0 flex-1">
        <Surroundings3D
          blocks={blocks}
          chest={chest}
          hideRoof={hideRoof}
          onHover={setHover}
          className="h-full w-full"
        />
        {/* Controls float over the view instead of taking a bar of their own. */}
        {status ? (
          <span
            className="pointer-events-none absolute left-3 top-3 max-w-[60%] truncate rounded-md
              bg-neutral-950/70 px-2.5 py-1 text-xs text-neutral-200"
          >
            {status}
          </span>
        ) : null}
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <label
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-neutral-950/70 px-2.5 py-1
              text-xs text-neutral-200"
          >
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
            className="rounded-md bg-neutral-950/70 p-1.5 text-neutral-300 transition hover:bg-neutral-800
              hover:text-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex text-xs">
          <span className="rounded-md bg-neutral-950/80 px-2.5 py-1.5 text-neutral-200">
            {hover ??
              (blocks
                ? 'Drag to orbit, scroll to zoom, right-drag to pan. Hover to see what something is.'
                : 'Waiting for the bot to spawn…')}
          </span>
        </div>
      </div>
    </div>
  )
}

export default WatcherPage
