import React, { useCallback, useEffect, useState } from 'react'
import { Backpack, Eye } from 'lucide-react'
import ChatPanel from './ChatPanel'
import InventoryPage from './InventoryPage'
import MiningPanel from './MiningPanel'
import WatcherPage from './WatcherPage'
import LocationManager from './LocationManager'
import SleepButton from './SleepButton'
import StatsSummary from './StatsSummary'
import { useSavedLocations } from '../hooks/useSavedLocations'
import type { BotSnapshot, ChatMessage, WorldView } from '../types'

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
  autoToolEnabled: boolean
  onAutoToolToggle: (value: boolean) => void
  autoShieldEnabled: boolean
  onAutoShieldToggle: (value: boolean) => void
  pathfinderEnabled: boolean
  pathfinderTarget: string
  pathfinder: import('../types').PathfinderOptions
  onPathfinderToggle: (value: boolean) => void
  onPathfinderTargetChange: (value: string) => void
  updatePathfinder: (options: import('../types').PathfinderOptions) => void
  pvpEnabled: boolean
  onPvpToggle: (value: boolean) => void
  onPvpConfigure: () => void
  allowBlockBreak: boolean
  onAllowBlockBreakToggle: (value: boolean) => void
  jumpAttackEnabled: boolean
  onJumpAttackToggle: (value: boolean) => void
  pvpPlayerEnabled: boolean
  pvpPlayerTarget: string
  onPvpPlayerToggle: (value: boolean) => void
  onPvpPlayerTargetChange: (value: string) => void
}

const Dashboard: React.FC<DashboardProps> = ({
  pathfinder,
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
  autoToolEnabled,
  onAutoToolToggle,
  autoShieldEnabled,
  onAutoShieldToggle,
  pathfinderEnabled,
  pathfinderTarget,
  onPathfinderToggle,
  onPathfinderTargetChange,
  updatePathfinder,
  pvpEnabled,
  onPvpToggle,
  onPvpConfigure,
  allowBlockBreak,
  onAllowBlockBreakToggle,
  jumpAttackEnabled,
  onJumpAttackToggle,
  pvpPlayerEnabled,
  pvpPlayerTarget,
  onPvpPlayerToggle,
  onPvpPlayerTargetChange,
}) => {
  const { locations, saveLocation, deleteLocation } = useSavedLocations()
  const [worldView, setWorldView] = useState<WorldView | null>(null)
  const [page, setPage] = useState<'watcher' | 'inventory' | null>(null)
  const closePage = useCallback(() => setPage(null), [])

  useEffect(() => {
    window.electronAPI.bot.getWorldView().then((view) => {
      if (view) {
        setWorldView(view)
      }
    })
    return window.electronAPI.bot.onWorld(setWorldView)
  }, [])
  const autoEatLabelId = 'dashboard-auto-eat-label'
  const pathfinderLabelId = 'dashboard-pathfinder-label'

  if (page === 'watcher' && !showChat) {
    return (
      <WatcherPage
        blocks={worldView?.blocks ?? null}
        chest={snapshot.mining?.chest ?? null}
        status={snapshot.mining?.active ? snapshot.mining.status : null}
        onClose={closePage}
      />
    )
  }

  if (page === 'inventory' && !showChat) {
    return <InventoryPage inventory={worldView?.inventory ?? null} onClose={closePage} />
  }

  return (
    <div className="flex flex-1 flex-col bg-neutral-950/60 text-neutral-100">
      <div className={showChat ? undefined : 'flex items-start gap-4 p-4'}>
        {!showChat ? (
          <aside className="flex w-56 shrink-0 flex-col gap-3">
            <StatsSummary snapshot={snapshot} />
            <MiningPanel mining={snapshot.mining} />
          </aside>
        ) : null}
        {!showChat ? (
          <div className="flex min-w-0 flex-1 flex-wrap content-start items-center gap-2">
            <label
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
            >
              <input
                type="checkbox"
                checked={armorManagerEnabled}
                onChange={(event) => onArmorManagerToggle(event.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
              <span className="tracking-normal text-neutral-200">Armor Manager</span>
            </label>
            <label
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
            >
              <input
                type="checkbox"
                checked={autoToolEnabled}
                onChange={(event) => onAutoToolToggle(event.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
              <span className="tracking-normal text-neutral-200">Auto Tool</span>
            </label>
            <label
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
            >
              <input
                type="checkbox"
                checked={autoShieldEnabled}
                onChange={(event) => onAutoShieldToggle(event.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
              <span className="tracking-normal text-neutral-200">Auto Shield</span>
            </label>
            <div
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
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
                className="tracking-normal text-neutral-200 transition hover:text-sky-300
                  focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                Auto Eat
              </button>
            </div>
            <div
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
            >
              <label className="flex items-center gap-2">
                <span className="text-[0.68rem] uppercase tracking-[0.2em] text-neutral-400">Follow</span>
                <input
                  type="text"
                  value={pathfinderTarget}
                  onChange={(event) => onPathfinderTargetChange(event.target.value)}
                  placeholder="Player username"
                  className="w-32 rounded-md border border-neutral-700 bg-neutral-950/70 px-2 py-1 text-xs
                    text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2
                    focus:ring-sky-500/30"
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
                  Follow
                </span>
              </label>
            </div>
            <div
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
            >
              <input
                id="dashboard-pvp-mob-toggle"
                type="checkbox"
                checked={pvpEnabled}
                onChange={(event) => onPvpToggle(event.target.checked)}
                className="h-4 w-4 accent-sky-500"
                aria-labelledby="dashboard-pvp-mob-label"
              />
              <button
                type="button"
                id="dashboard-pvp-mob-label"
                onClick={onPvpConfigure}
                className="tracking-normal text-neutral-200 transition hover:text-sky-300
                  focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                Attack Mobs
              </button>
            </div>
            <div
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
            >
              <input
                id="dashboard-break-blocks-toggle"
                type="checkbox"
                checked={allowBlockBreak}
                onChange={(event) => onAllowBlockBreakToggle(event.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
              <label
                htmlFor="dashboard-break-blocks-toggle"
                className="tracking-normal text-neutral-200 cursor-pointer select-none"
              >
                Break Blocks
              </label>
            </div>
            <div
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
            >
              <input
                id="dashboard-jump-attack-toggle"
                type="checkbox"
                checked={jumpAttackEnabled}
                onChange={(event) => onJumpAttackToggle(event.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
              <label
                htmlFor="dashboard-jump-attack-toggle"
                className="tracking-normal text-neutral-200 cursor-pointer select-none"
              >
                Jump Attack
              </label>
            </div>
            <div
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300"
            >
              <label className="flex items-center gap-2">
                <span className="text-[0.68rem] uppercase tracking-[0.2em] text-neutral-400">
                  Attack Player
                </span>
                <input
                  type="text"
                  value={pvpPlayerTarget}
                  onChange={(event) => onPvpPlayerTargetChange(event.target.value)}
                  placeholder="Player username"
                  className="w-32 rounded-md border border-neutral-700 bg-neutral-950/70 px-2 py-1 text-xs
                    text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2
                    focus:ring-sky-500/30"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={pvpPlayerEnabled}
                  onChange={(event) => onPvpPlayerToggle(event.target.checked)}
                  className="h-4 w-4 accent-sky-500"
                />
                <span className="tracking-normal text-neutral-200">Enable</span>
              </label>
            </div>
            <button
              type="button"
              onClick={() => setPage('watcher')}
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold text-neutral-200 transition hover:border-neutral-600
                hover:text-sky-300"
            >
              <Eye className="h-4 w-4" />
              Watcher
            </button>
            <button
              type="button"
              onClick={() => setPage('inventory')}
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4
                py-2 text-xs font-semibold text-neutral-200 transition hover:border-neutral-600
                hover:text-sky-300"
            >
              <Backpack className="h-4 w-4" />
              Inventory
            </button>
            <SleepButton
              isSleeping={Boolean(snapshot.isSleeping)}
              canSleep={Boolean(snapshot.canSleep)}
              bedPickupPending={Boolean(snapshot.bedPickupPending)}
            />
            <LocationManager
              currentPosition={snapshot.position}
              savedLocations={locations}
              onSaveLocation={saveLocation}
              onDeleteLocation={deleteLocation}
              onGoToLocation={(location) => {
                // Send a single update that disables follow and issues a one-shot
                // goToLocation so the backend receives both instructions atomically.
                updatePathfinder({
                  followEnabled: false,
                  followTarget: pathfinder.followTarget,
                  goToLocation: {
                    x: location.x,
                    y: location.y,
                    z: location.z,
                  },
                })
              }}
              onCancelTravel={() => {
                updatePathfinder({
                  followEnabled: false,
                  followTarget: pathfinder.followTarget,
                  cancelGoTo: true,
                })
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 px-6">
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
