import React, { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Square } from 'lucide-react'
import type { ScriptLogEntry } from '../../../shared/types'

// Turns the running script off (its stop() runs first, which can take a moment).
export const TurnOffButton: React.FC<{ status: string; className?: string }> = ({
  status,
  className = '',
}) => {
  const [error, setError] = useState<string | null>(null)
  const stopping = status === 'Stopping…'

  const stop = async () => {
    setError(null)
    try {
      const result = await window.electronAPI.scripts.stop()
      if (!result.ok) setError(result.message ?? 'Could not turn it off.')
    } catch {
      setError('Could not turn it off. Try again.')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void stop()}
        disabled={stopping}
        className={`flex items-center justify-center gap-2 rounded-full border border-red-900 bg-red-950/60
          font-semibold text-red-200 transition hover:border-red-700 disabled:opacity-60 ${className}`}
      >
        {stopping ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Square className="h-3.5 w-3.5" />
        )}
        {stopping ? 'Turning off…' : 'Turn off'}
      </button>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </>
  )
}

// The scripts' log, oldest first, kept scrolled to the newest line.
export const ScriptLogList: React.FC<{ log: ScriptLogEntry[]; className?: string }> = ({
  log,
  className = '',
}) => {
  const list = useRef<HTMLOListElement>(null)

  // Scrolls just the list, not the page around it.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [log.length])

  return (
    <ol ref={list} className={`min-h-0 flex-1 overflow-y-auto font-mono leading-relaxed ${className}`}>
      {log.length === 0 ? <li className="text-neutral-500">Nothing yet.</li> : null}
      {log.map((entry, index) => (
        <li
          key={`${entry.at}-${index}`}
          className={entry.level === 'error' ? 'text-red-300' : 'text-neutral-300'}
        >
          <span className="text-neutral-500">
            {new Date(entry.at).toLocaleTimeString([], { hour12: false })}{' '}
          </span>
          {entry.text}
        </li>
      ))}
    </ol>
  )
}
