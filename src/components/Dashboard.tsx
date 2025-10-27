import React from 'react'
import ChatPanel from './ChatPanel'
import StatsSummary from './StatsSummary'
import type { BotSnapshot, ChatMessage } from '../types'

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

type DashboardProps = {
  snapshot: ConnectedSnapshot
  chatMessages: ChatMessage[]
  chatInput: string
  onChatInputChange: (value: string) => void
  onChatSubmit: () => void
  isSendingChat: boolean
  showChat: boolean
  armorManagerEnabled: boolean
  onArmorManagerToggle: (value: boolean) => void
  autoEatEnabled: boolean
  onAutoEatToggle: (value: boolean) => void
  onAutoEatConfigure: () => void
  pathfinderEnabled: boolean
  pathfinderTarget: string
  onPathfinderToggle: (value: boolean) => void
  onPathfinderTargetChange: (value: string) => void
}

const Dashboard: React.FC<DashboardProps> = ({
  snapshot,
  chatMessages,
  chatInput,
  onChatInputChange,
  onChatSubmit,
  isSendingChat,
  showChat,
  armorManagerEnabled,
  onArmorManagerToggle,
  autoEatEnabled,
  onAutoEatToggle,
  onAutoEatConfigure,
  pathfinderEnabled,
  pathfinderTarget,
  onPathfinderToggle,
  onPathfinderTargetChange,
}) => {
  const autoEatLabelId = 'dashboard-auto-eat-label'
  const pathfinderLabelId = 'dashboard-pathfinder-label'

  return (
    <div className="flex flex-1 flex-col bg-neutral-950/60 text-neutral-100">
      <div className="flex items-center justify-between px-6 pt-6">
        {!showChat ? <StatsSummary snapshot={snapshot} /> : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <label
            className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4 py-2
              text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
          >
            <input
              type="checkbox"
              checked={armorManagerEnabled}
              onChange={(event) => onArmorManagerToggle(event.target.checked)}
              className="h-4 w-4 accent-sky-500"
            />
            <span className="tracking-normal text-neutral-200">Armor Manager</span>
          </label>
          <div
            className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4 py-2
              text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
          >
            <input
              id="dashboard-auto-eat-toggle"
              type="checkbox"
              checked={autoEatEnabled}
              onChange={(event) => onAutoEatToggle(event.target.checked)}
              className="h-4 w-4 accent-sky-500"
              aria-labelledby={autoEatLabelId}
            />
            <button
              type="button"
              id={autoEatLabelId}
              onClick={onAutoEatConfigure}
              className="tracking-normal text-neutral-200 transition hover:text-sky-300 focus-visible:outline
                focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              Auto Eat
            </button>
          </div>
          <div
            className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4 py-2
              text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
          >
            <label className="flex items-center gap-2">
              <span className="text-[0.68rem] uppercase tracking-[0.2em] text-neutral-400">Follow</span>
              <input
                type="text"
                value={pathfinderTarget}
                onChange={(event) => onPathfinderTargetChange(event.target.value)}
                placeholder="Player username"
                className="w-32 rounded-md border border-neutral-700 bg-neutral-950/70 px-2 py-1 text-xs text-neutral-100
                  focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </label>
            <label className="flex items-center gap-2" htmlFor="dashboard-pathfinder-toggle">
              <input
                id="dashboard-pathfinder-toggle"
                type="checkbox"
                checked={pathfinderEnabled}
                onChange={(event) => onPathfinderToggle(event.target.checked)}
                className="h-4 w-4 accent-sky-500"
                aria-labelledby={pathfinderLabelId}
              />
              <span id={pathfinderLabelId} className="tracking-normal text-neutral-200">
                Pathfinder
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-1 px-6 py-6">
        {showChat ? (
          <ChatPanel
            chatMessages={chatMessages}
            chatInput={chatInput}
            onChatInputChange={onChatInputChange}
            onChatSubmit={onChatSubmit}
            isSendingChat={isSendingChat}
            fullHeight
          />
        ) : null}
      </div>
    </div>
  )
}

export default Dashboard
