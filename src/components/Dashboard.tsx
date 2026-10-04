import React, { useCallback, useEffect, useRef, useState } from 'react'
import ChatPanel from './ChatPanel'
import InventoryPage from './InventoryPage'
import Surroundings3D from './Surroundings3D'
import EntityPopover from './watcher/EntityPopover'
import LocationManager from './LocationManager'
import StatsSummary from './StatsSummary'
import { useSavedLocations } from '../hooks/useSavedLocations'
import type { BotSnapshot, ChatMessage, MotionEntity, WorldView } from '../types'

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

type DashboardProps = {
  snapshot: ConnectedSnapshot
  chatMessages: ChatMessage[]
  chatInput: string
  onChatInputChange: (value: string) => void
  onChatSubmit: () => Promise<boolean>
  onChatOpen: () => void
  onChatClose: () => void
  isSendingChat: boolean
  showChat: boolean
  pathfinder: import('../types').PathfinderOptions
  updatePathfinder: (options: import('../types').PathfinderOptions) => void
}

const Dashboard: React.FC<DashboardProps> = ({
  pathfinder,
  snapshot,
  chatMessages,
  chatInput,
  onChatInputChange,
  onChatSubmit,
  onChatOpen,
  onChatClose,
  isSendingChat,
  showChat,
  updatePathfinder,
}) => {
  const { locations, saveLocation, deleteLocation } = useSavedLocations()
  const [worldView, setWorldView] = useState<WorldView | null>(null)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [openingBlock, setOpeningBlock] = useState(false)
  const [blockFeedback, setBlockFeedback] = useState<string | null>(null)
  const containerId = useRef<number | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [entityContext, setEntityContext] = useState<{
    entity: MotionEntity
    position: { x: number; y: number }
  } | null>(null)
  const closeEntityContext = useCallback(() => setEntityContext(null), [])
  const closePage = useCallback(() => setInventoryOpen(false), [])

  useEffect(() => {
    window.electronAPI.bot.getWorldView().then((view) => {
      if (view) {
        setWorldView(view)
      }
    })
    return window.electronAPI.bot.onWorld(setWorldView)
  }, [])
  useEffect(() => {
    const id = worldView?.inventory.window?.id ?? null
    if (containerId.current !== null && id === null) setInventoryOpen(false)
    containerId.current = id
  }, [worldView])
  const interactBlock = async (position: { x: number; y: number; z: number }) => {
    if (openingBlock || inventoryOpen) return
    setOpeningBlock(true)
    setBlockFeedback('Opening block…')
    try {
      const result = await window.electronAPI.bot.interactBlock(position)
      if (!result.ok) { setBlockFeedback(result.message ?? 'Could not open block.'); return }
      const view = await window.electronAPI.bot.getWorldView()
      if (view?.inventory.window) { setWorldView(view); setInventoryOpen(true); setBlockFeedback(null) }
      else setBlockFeedback('The block closed before it could be displayed.')
    } catch (error) { setBlockFeedback(error instanceof Error ? error.message : 'Could not open block.') }
    finally { setOpeningBlock(false) }
  }
  useEffect(() => {
    if (!blockFeedback || openingBlock) return
    const timer = setTimeout(() => setBlockFeedback(null), 5000)
    return () => clearTimeout(timer)
  }, [blockFeedback, openingBlock])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (
        showChat ||
        openingBlock ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest('input, textarea, select, [contenteditable="true"]') ||
        document.querySelector('[aria-modal="true"]')
      )
        return
      if (!inventoryOpen && !entityContext && (event.code === 'KeyT' || event.code === 'Slash')) {
        event.preventDefault()
        onChatInputChange(event.code === 'Slash' ? '/' : '')
        onChatOpen()
        return
      }
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault()
        setEntityContext(null)
        setInventoryOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [showChat, openingBlock, inventoryOpen, entityContext, onChatInputChange, onChatOpen])

  return (
    <div className="relative min-h-0 min-w-0 flex-1 bg-neutral-950 text-neutral-100">
      <Surroundings3D
        onBlockInteract={interactBlock}
        movementEnabled={!openingBlock && !inventoryOpen && !showChat && !entityContext}
        blocks={worldView?.blocks ?? null}
        chest={snapshot.mining?.chest ?? null}
        onHover={setHover}
        onEntityContext={(entity, position) => setEntityContext({ entity, position })}
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
        <div className="pointer-events-auto absolute right-3 top-15 flex items-center gap-2">
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
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-4 text-xs">
          <span className="max-w-[65%] truncate rounded-md bg-neutral-950/80 px-2.5 py-1.5 text-neutral-300">
            {hover ??
              (snapshot.position
                ? `X ${Math.floor(snapshot.position.x)} · Y ${Math.floor(snapshot.position.y)} · Z ${Math.floor(snapshot.position.z)}`
                : 'Waiting for the bot to spawn…')}
          </span>
          {snapshot.mining?.active ? (
            <span className="max-w-[35%] truncate rounded-md bg-neutral-950/80 px-2.5 py-1.5 text-sky-300">
              {snapshot.mining.status}
            </span>
          ) : null}
        </div>
      </div>
      {blockFeedback && <div role="status" className="absolute bottom-12 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-white/10 bg-neutral-900/80 px-4 py-2 text-xs backdrop-blur-xl">{blockFeedback}</div>}
      {inventoryOpen && !showChat ? (
        <InventoryPage key={worldView?.inventory.window?.id ?? 0} inventory={worldView?.inventory ?? null} onClose={closePage} />
      ) : null}
      {entityContext && !inventoryOpen && !showChat ? (
        <EntityPopover
          key={`${entityContext.entity.id}:${entityContext.position.x}:${entityContext.position.y}`}
          entity={entityContext.entity}
          position={entityContext.position}
          onClose={closeEntityContext}
        />
      ) : null}
      <ChatPanel
        chatMessages={chatMessages}
        chatInput={chatInput}
        onChatInputChange={onChatInputChange}
        onChatSubmit={onChatSubmit}
        isSendingChat={isSendingChat}
        open={showChat}
        onClose={onChatClose}
        hidden={inventoryOpen || Boolean(entityContext)}
      />

    </div>
  )
}

export default Dashboard
