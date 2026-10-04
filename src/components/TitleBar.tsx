import React from 'react'
import {
  Apple,
  ChevronsUp,
  Hammer,
  MessageSquareText,
  Minus,
  Pickaxe,
  ShieldHalf,
  Swords,
  X,
} from 'lucide-react'
import SleepButton from './SleepButton'
import ToolbarButton from './ToolbarButton'
import MiningPanel from './MiningPanel'
import type { BotStatus, MiningState } from '../types'

const ArmorIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-[18px] w-[18px]"
  >
    <path d="M8 3 3 5v6l3 1v8h12v-8l3-1V5l-5-2c0 3-8 3-8 0Z" />
    <path d="M8 3v5l4 3 4-3V3M12 11v9M8 16h8" />
  </svg>
)

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
  armorManagerEnabled: boolean
  onArmorManagerToggle: (value: boolean) => void
  autoShieldEnabled: boolean
  onAutoShieldToggle: (value: boolean) => void
  autoEatEnabled: boolean
  onAutoEatToggle: (value: boolean) => void
  onAutoEatConfigure: () => void
  autoToolEnabled: boolean
  onAutoToolToggle: (value: boolean) => void
  pvpEnabled: boolean
  onPvpToggle: (value: boolean) => void
  onPvpConfigure: () => void
  allowBlockBreak: boolean
  onAllowBlockBreakToggle: (value: boolean) => void
  mining: MiningState | undefined
  isSleeping: boolean
  canSleep: boolean
  bedPickupPending: boolean
  jumpAttackEnabled: boolean
  onJumpAttackToggle: (value: boolean) => void
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
  armorManagerEnabled,
  onArmorManagerToggle,
  autoShieldEnabled,
  onAutoShieldToggle,
  autoEatEnabled,
  onAutoEatToggle,
  onAutoEatConfigure,
  autoToolEnabled,
  onAutoToolToggle,
  pvpEnabled,
  onPvpToggle,
  onPvpConfigure,
  allowBlockBreak,
  onAllowBlockBreakToggle,
  mining,
  isSleeping,
  canSleep,
  bedPickupPending,
  jumpAttackEnabled,
  onJumpAttackToggle,
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
      <div className="flex min-w-0 flex-1 items-center gap-2 pr-3">
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

      <div className="app-region-no-drag flex shrink-0 items-center gap-2">
        {isConnected ? (
          <>
            <ToolbarButton
              label="Armor Manager"
              description="Automatically equip armor. Click to toggle."
              active={armorManagerEnabled}
              onClick={() => onArmorManagerToggle(!armorManagerEnabled)}
            >
              <ArmorIcon />
            </ToolbarButton>
            <ToolbarButton
              label="Auto Shield"
              description="Automatically block with a shield. Click to toggle."
              active={autoShieldEnabled}
              onClick={() => onAutoShieldToggle(!autoShieldEnabled)}
            >
              <ShieldHalf aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </ToolbarButton>
            <ToolbarButton
              label="Auto Tool"
              description="Automatically choose the right tool. Click to toggle."
              active={autoToolEnabled}
              onClick={() => onAutoToolToggle(!autoToolEnabled)}
            >
              <Pickaxe aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </ToolbarButton>
            <ToolbarButton
              label="Auto Eat"
              description="Eat automatically. Click to toggle. Right-click for settings."
              active={autoEatEnabled}
              onClick={() => onAutoEatToggle(!autoEatEnabled)}
              onConfigure={onAutoEatConfigure}
            >
              <Apple aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </ToolbarButton>
            <ToolbarButton
              label="Attack Mobs"
              description="Attack mobs automatically. Click to toggle. Right-click for settings."
              active={pvpEnabled}
              onClick={() => onPvpToggle(!pvpEnabled)}
              onConfigure={onPvpConfigure}
            >
              <Swords aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </ToolbarButton>
            <ToolbarButton
              label="Jump Attack"
              description="Jump during attacks. Click to toggle."
              active={jumpAttackEnabled}
              onClick={() => onJumpAttackToggle(!jumpAttackEnabled)}
            >
              <ChevronsUp aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </ToolbarButton>
            <MiningPanel mining={mining} />
            <ToolbarButton
              label="Break Blocks"
              description="Allow breaking blocks while navigating. Click to toggle."
              active={allowBlockBreak}
              onClick={() => onAllowBlockBreakToggle(!allowBlockBreak)}
            >
              <Hammer aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </ToolbarButton>
          </>
        ) : null}
        <ToolbarButton
          label={isConnected ? 'Chat' : 'Saved Chats'}
          description={
            isChatActive
              ? 'Click to hide the chat panel.'
              : isConnected
                ? 'Click to open the chat panel.'
                : 'Click to view saved conversations.'
          }
          active={isChatActive}
          onClick={onToggleChat}
        >
          <MessageSquareText aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </ToolbarButton>
        {isConnected ? (
          <SleepButton isSleeping={isSleeping} canSleep={canSleep} bedPickupPending={bedPickupPending} />
        ) : null}
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
