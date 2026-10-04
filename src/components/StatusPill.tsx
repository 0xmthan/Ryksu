import React, { useEffect, useState } from 'react'
import { CircleAlert, LoaderCircle, LogOut, X } from 'lucide-react'
import type { BotStatus } from '../types'

type StatusPillProps = {
  status: BotStatus
  lastError: string | null
  isConnecting: boolean
  onDismissError: () => void
}

// Connection progress and results, in the same pill style as the sleep button. Messages that need reading
// or acting on (sign-in codes, warnings, kick reasons) also go to chat.
const StatusPill: React.FC<StatusPillProps> = ({ status, lastError, isConnecting, onDismissError }) => {
  const stage = status?.stage
  const [showDisconnected, setShowDisconnected] = useState(false)

  useEffect(() => {
    if (stage !== 'disconnected') return
    setShowDisconnected(true)
    const timeout = setTimeout(() => setShowDisconnected(false), 4000)
    return () => clearTimeout(timeout)
  }, [status, stage])

  let content: { icon: React.ReactNode; text: string; className: string } | null = null
  if (lastError) {
    content = {
      icon: <CircleAlert aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />,
      text: lastError,
      className: 'border-rose-500/40 text-rose-200',
    }
  } else if (stage === 'auth-required') {
    content = {
      icon: <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" strokeWidth={1.75} />,
      text: 'Waiting for Microsoft sign-in…',
      className: 'border-sky-400/40 text-sky-100',
    }
  } else if (stage === 'connecting' || isConnecting) {
    content = {
      icon: <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" strokeWidth={1.75} />,
      text: (stage === 'connecting' && status?.message) || 'Connecting…',
      className: 'border-amber-400/40 text-amber-100',
    }
  } else if (stage === 'disconnected' && showDisconnected) {
    content = {
      icon: <LogOut aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />,
      text: 'Disconnected',
      className: 'border-neutral-700/60 text-neutral-300',
    }
  }

  if (!content) return null

  return (
    <div
      role="status"
      title={content.text}
      className={`flex h-8 min-w-0 max-w-80 shrink items-center rounded-full border bg-neutral-900/70 ${content.className}`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center">{content.icon}</span>
      <span className="truncate pr-3 text-xs">{content.text}</span>
      {lastError ? (
        <button
          type="button"
          onClick={onDismissError}
          aria-label="Dismiss"
          className="-ml-1 mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-rose-300
            hover:bg-rose-500/20 hover:text-rose-100"
        >
          <X aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  )
}

export default StatusPill
