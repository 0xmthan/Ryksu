import React, { useCallback, useEffect, useState } from 'react'
import { Backpack } from 'lucide-react'
import ChatPanel from './ChatPanel'
import InventoryPage from './InventoryPage'
import Surroundings3D from './Surroundings3D'
import LocationManager from './LocationManager'
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
  pathfinderEnabled: boolean
  pathfinderTarget: string
  pathfinder: import('../types').PathfinderOptions
  onPathfinderToggle: (value: boolean) => void
  onPathfinderTargetChange: (value: string) => void
  updatePathfinder: (options: import('../types').PathfinderOptions) => void
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
  pathfinderEnabled,
  pathfinderTarget,
  onPathfinderToggle,
  onPathfinderTargetChange,
  updatePathfinder,
  pvpPlayerEnabled,
  pvpPlayerTarget,
  onPvpPlayerToggle,
  onPvpPlayerTargetChange,
}) => {
  const { locations, saveLocation, deleteLocation } = useSavedLocations()
  const [worldView, setWorldView] = useState<WorldView | null>(null)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const closePage = useCallback(() => setInventoryOpen(false), [])

  useEffect(() => {
    window.electronAPI.bot.getWorldView().then((view) => {
      if (view) {
        setWorldView(view)
      }
    })
    return window.electronAPI.bot.onWorld(setWorldView)
  }, [])
  const pathfinderLabelId = 'dashboard-pathfinder-label'

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (
        showChat ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest('input, textarea, select, [contenteditable="true"]') ||
        document.querySelector('[aria-modal="true"]')
      )
        return
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault()
        setInventoryOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [showChat])

  return (
    <div className="relative min-h-0 min-w-0 flex-1 bg-neutral-950 text-neutral-100">
      <Surroundings3D
        blocks={worldView?.blocks ?? null}
        chest={snapshot.mining?.chest ?? null}
        onHover={setHover}
        onWalkTo={(target) =>
          updatePathfinder({
            followEnabled: false,
            followTarget: pathfinder.followTarget,
            goToLocation: target,
          })
        }
        className="absolute inset-0 h-full w-full"
      />
      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-3 top-15 w-64">
          <StatsSummary snapshot={snapshot} />
        </div>
        <div className="pointer-events-auto absolute right-3 top-15">
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
                  text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
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
        </div>
        <div className="pointer-events-auto absolute bottom-14 right-3">
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
                  text-neutral-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
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
        </div>
        <div className="pointer-events-auto absolute bottom-14 left-3 flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => setInventoryOpen(true)}
            className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/90 px-3
              py-2 text-xs text-neutral-200 hover:text-sky-300"
          >
            <Backpack className="h-4 w-4" /> Inventory <kbd className="text-neutral-500">E</kbd>
          </button>
        </div>
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-4 text-xs">
          <span className="max-w-[65%] truncate rounded-md bg-neutral-950/80 px-2.5 py-1.5 text-neutral-300">
            {hover ??
              (worldView?.blocks
                ? 'Click to walk · Double-click mobs to attack · Drag to orbit · Scroll to zoom · E inventory'
                : 'Waiting for the bot to spawn…')}
          </span>
          {snapshot.mining?.active ? (
            <span className="max-w-[35%] truncate rounded-md bg-neutral-950/80 px-2.5 py-1.5 text-sky-300">
              {snapshot.mining.status}
            </span>
          ) : null}
        </div>
      </div>
      {inventoryOpen && !showChat ? (
        <InventoryPage inventory={worldView?.inventory ?? null} onClose={closePage} />
      ) : null}
      {showChat ? (
        <div className="absolute inset-x-0 bottom-0 top-12 z-40 flex bg-neutral-950 px-6">
          <ChatPanel
            chatMessages={chatMessages}
            chatInput={chatInput}
            onChatInputChange={onChatInputChange}
            onChatSubmit={onChatSubmit}
            isSendingChat={isSendingChat}
            fullHeight
          />
        </div>
      ) : null}
    </div>
  )
}

export default Dashboard
