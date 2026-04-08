import React from 'react'
import { MessageSquareText, Minus, X } from 'lucide-react'
import type { BotStatus } from '../types'

type TitleBarProps = {
  status: BotStatus
  lastError: string | null
  isConnecting: boolean
  isConnected: boolean
  canConnect: boolean
  onConnect: () => void
  onDisconnect: () => void
  onToggleChat: () => void
  isChatActive: boolean
}

const TitleBar: React.FC<TitleBarProps> = ({
  status,
  lastError,
  isConnecting,
  isConnected,
  canConnect,
  onConnect,
  onDisconnect,
  onToggleChat,
  isChatActive,
}) => {
  const handleMinimize = () => {
    window.electronAPI?.minimize()
  }

  const handleClose = () => {
    window.electronAPI?.close()
  }

  const stage = status?.stage ?? 'idle'
  const stageLabel = stage.charAt(0).toUpperCase() + stage.slice(1)
  const statusMessage = lastError ?? status?.message ?? stageLabel

  const indicatorColor = lastError
    ? 'bg-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.45)]'
    : stage === 'connected'
      ? 'bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.35)]'
      : stage === 'connecting' || isConnecting
        ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.35)]'
        : 'bg-neutral-500 shadow-[0_0_10px_rgba(115,115,115,0.25)]'

  const messageTone = lastError
    ? 'text-rose-200'
    : stage === 'connected'
      ? 'text-emerald-200'
      : stage === 'connecting' || isConnecting
        ? 'text-amber-200'
        : 'text-neutral-300'

  const primaryActionLabel = isConnected ? 'Disconnect' : isConnecting ? 'Connecting…' : 'Connect'
  const primaryActionDisabled = isConnected ? false : !canConnect || isConnecting
  const primaryActionStyle = isConnected
    ? 'border border-rose-500/60 bg-transparent text-rose-100 hover:bg-rose-500/10 focus-visible:outline-rose-400'
    : 'border border-transparent bg-sky-500 text-neutral-950 hover:bg-sky-400 focus-visible:outline-sky-400 disabled:border-neutral-800 disabled:bg-neutral-800 disabled:text-neutral-500'

  const handlePrimaryAction = () => {
    if (primaryActionDisabled) {
      return
    }

    if (isConnected) {
      onDisconnect()
      return
    }

    onConnect()
  }

  return (
    <header
      className="app-region-drag flex h-12 items-center justify-between border-b border-neutral-800
        bg-neutral-950/70 px-4 backdrop-blur"
    >
      <div className="flex flex-1 items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${indicatorColor}`} />
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex flex-col leading-none">
            <span className="text-xl font-bold uppercase text-neutral-100">Ryksu</span>
            <span className="text-[0.6rem] font-semibold tracking-[0.13em] uppercase text-neutral-500 -mt-1.5">
              by 2mdtln
            </span>
          </div>
          <span className={`truncate text-xs font-italic uppercase ${messageTone}`}>{statusMessage}</span>
        </div>
      </div>

      <div className="app-region-no-drag flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleChat}
          className={`group flex h-8 w-8 items-center justify-center rounded-full border border-neutral-700/60
            bg-neutral-900/70 transition focus-visible:outline focus-visible:outline-offset-2
            focus-visible:outline-sky-400 ${isChatActive ? 'border-sky-500/60' : 'hover:border-neutral-500'}`}
          aria-label={
            isChatActive
              ? isConnected
                ? 'Hide chat panel'
                : 'Hide saved chats'
              : isConnected
                ? 'Show chat panel'
                : 'Show saved chats'
          }
        >
          <MessageSquareText className="h-4 w-4 text-white" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={handlePrimaryAction}
          disabled={primaryActionDisabled}
          className={`inline-flex items-center justify-center rounded-full px-4 py-1.5 text-[0.7rem]
            font-semibold uppercase transition focus-visible:outline focus-visible:outline-offset-2
            disabled:cursor-not-allowed ${primaryActionStyle}`}
        >
          {primaryActionLabel}
        </button>
        <button
          type="button"
          onClick={handleMinimize}
          className="group relative flex h-8 w-8 items-center justify-center rounded-full border
            border-neutral-700/60 bg-neutral-900/70 text-neutral-300 transition hover:border-sky-500/50
            hover:bg-sky-500/15 hover:text-neutral-100 focus-visible:outline focus-visible:outline-offset-2
            focus-visible:outline-sky-400"
          aria-label="Minimize window"
        >
          <span className="sr-only">Minimize</span>
          <Minus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="group relative flex h-8 w-8 items-center justify-center rounded-full border
            border-neutral-700/60 bg-neutral-900/70 text-neutral-300 transition hover:border-rose-500/60
            hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline focus-visible:outline-offset-2
            focus-visible:outline-rose-400"
          aria-label="Close window"
        >
          <span className="sr-only">Close</span>
          <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  )
}

export default TitleBar
