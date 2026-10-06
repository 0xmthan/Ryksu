import React, { useCallback, useEffect, useRef, useState } from 'react'
import ChatPanel from './ChatPanel'
import InventoryPage from './InventoryPage'
import Surroundings3D from './Surroundings3D'
import EntityPopover from './watcher/EntityPopover'
import LocationManager from './LocationManager'
import TradePanel from './TradePanel'
import TabPanel from './TabPanel'
import { prettyName } from '../utils/blockColors'
import { Hammer } from 'lucide-react'
import { PICK_MINING_CHESTS_EVENT } from './MiningPanel'
import VitalBars, { Hotbar } from './VitalBars'
import { useSavedLocations } from '../hooks/useSavedLocations'
import type {
  AutoEatOptions,
  BotSnapshot,
  BuildAction,
  BuildCells,
  ChatMessage,
  MotionEntity,
  TradeOffer,
  WorldView,
} from '../types'
import { HOTBAR_START } from '../shared/inventory'

// Window slot of the first hotbar slot in the player inventory.

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
  // Set only while auto eat is on.
  autoEat: AutoEatOptions | null
  // A page is open over the game (settings): the view gives the mouse and keys back.
  paused?: boolean
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
  autoEat,
  paused = false,
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
  const miningActive = Boolean(snapshot.mining?.active)
  const following = pathfinder.followEnabled && pathfinder.followTarget ? pathfinder.followTarget : null

  // Chest picking for Auto Mine: started from the mining panel, clicks on chests add or remove them.
  const [pickingChests, setPickingChests] = useState(false)
  useEffect(() => {
    const start = () => {
      setBuildMode(false)
      setInventoryOpen(false)
      setPickingChests(true)
    }
    window.addEventListener(PICK_MINING_CHESTS_EVENT, start)
    return () => window.removeEventListener(PICK_MINING_CHESTS_EVENT, start)
  }, [])
  const pickChest = useCallback(async (block: { x: number; y: number; z: number; name: string }) => {
    try {
      const result = await window.electronAPI.bot.toggleMiningChest(block)
      setBlockFeedback(
        result.ok
          ? `${result.added ? 'Added' : 'Removed'} the chest at ${block.x} ${block.y} ${block.z}.`
          : (result.message ?? 'Could not pick that chest.')
      )
    } catch {
      setBlockFeedback('Could not pick that chest.')
    }
  }, [])

  // Build mode (B): clicks on blocks break and place instead of walking and opening.
  const [buildMode, setBuildMode] = useState(false)
  // What the bot still has to break and place, marked in the watcher.
  const [queuedBuild, setQueuedBuild] = useState<BuildCells | null>(null)
  useEffect(() => window.electronAPI.bot.onBuildCells(setQueuedBuild), [])
  const build = useCallback(async (action: BuildAction) => {
    setBlockFeedback(action.type === 'break' ? 'Breaking…' : 'Placing…')
    try {
      const result = await window.electronAPI.bot.buildAction(action)
      setBlockFeedback(result.message ?? (result.ok ? 'Done.' : 'That did not work.'))
    } catch {
      setBlockFeedback('That did not work.')
    }
  }, [])

  // Leaving build mode (B or Esc) stops a line the bot is still working through.
  const wasBuilding = useRef(false)
  useEffect(() => {
    if (wasBuilding.current && !buildMode) {
      window.electronAPI.bot.cancelBuild().then((result) => {
        if (result.stopped) setBlockFeedback('Stopped building.')
      })
    }
    wasBuilding.current = buildMode
  }, [buildMode])

  // The player list, shown while Tab is held.
  const [tabOpen, setTabOpen] = useState(false)
  useEffect(() => {
    if (!tabOpen) return
    const release = (event: KeyboardEvent) => {
      if (event.code === 'Tab') setTabOpen(false)
    }
    const hide = () => setTabOpen(false)
    window.addEventListener('keyup', release)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('keyup', release)
      window.removeEventListener('blur', hide)
    }
  }, [tabOpen])
  const [trader, setTrader] = useState<{ title: string; trades: TradeOffer[] } | null>(null)
  const closeTrader = useCallback(() => {
    setTrader(null)
    window.electronAPI.bot.closeTrader()
  }, [])
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
    // The server closed the window (or the trader walked off).
    if (containerId.current !== null && id === null) {
      setInventoryOpen(false)
      setTrader(null)
    }
    containerId.current = id
  }, [worldView])
  const interactBlock = async (position: { x: number; y: number; z: number }) => {
    if (openingBlock || inventoryOpen) return
    setOpeningBlock(true)
    setBlockFeedback('Opening block…')
    try {
      const result = await window.electronAPI.bot.interactBlock(position)
      if (!result.ok) {
        setBlockFeedback(result.message ?? 'Could not open block.')
        return
      }
      const view = await window.electronAPI.bot.getWorldView()
      if (view?.inventory.window) {
        setWorldView(view)
        setInventoryOpen(true)
        setBlockFeedback(null)
      } else setBlockFeedback('The block closed before it could be displayed.')
    } catch (error) {
      setBlockFeedback(error instanceof Error ? error.message : 'Could not open block.')
    } finally {
      setOpeningBlock(false)
    }
  }
  useEffect(() => window.electronAPI.bot.onNotice(setBlockFeedback), [])
  // A follow (a gesture, the Follow button, …) stays in the bubble until it stops, then says so briefly.
  const lastFollowing = useRef(following)
  useEffect(() => {
    const previous = lastFollowing.current
    lastFollowing.current = following
    if (previous && !following) setBlockFeedback(`Stopped following ${previous}`)
  }, [following])
  useEffect(() => {
    if (!blockFeedback || openingBlock) return
    const timer = setTimeout(() => setBlockFeedback(null), 5000)
    return () => clearTimeout(timer)
  }, [blockFeedback, openingBlock])

  const selectHotbar = useCallback(async (index: number) => {
    const result = await window.electronAPI.bot.inventoryAction({ type: 'hold', slot: HOTBAR_START + index })
    if (!result.ok) setBlockFeedback(result.message ?? 'Could not switch slot.')
    return result.ok
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (
        showChat ||
        openingBlock ||
        // Held Tab repeats; those still need their default (focus moving) stopped.
        (event.repeat && event.code !== 'Tab') ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest('input, textarea, select, [contenteditable="true"]') ||
        document.querySelector('[aria-modal="true"]')
      )
        return
      if (pickingChests && (event.code === 'Escape' || event.code === 'Enter')) {
        event.preventDefault()
        setPickingChests(false)
        return
      }
      if (event.code === 'KeyB' && !inventoryOpen && !entityContext && !pickingChests) {
        event.preventDefault()
        setBuildMode((on) => !on)
        return
      }
      if (event.code === 'Escape' && buildMode) {
        setBuildMode(false)
        return
      }
      if (event.code === 'Escape' && miningActive) {
        event.preventDefault()
        setBlockFeedback('Stopping mining…')
        window.electronAPI.bot
          .stopMining()
          .then(() => setBlockFeedback('Stopped mining.'))
          .catch(() => setBlockFeedback('Could not stop mining.'))
        return
      }
      if (event.code === 'Escape' && following) {
        event.preventDefault()
        updatePathfinder({ followEnabled: false, followTarget: following })
        return
      }
      if (event.code === 'Tab') {
        event.preventDefault()
        if (!inventoryOpen) setTabOpen(true)
        return
      }
      if (!inventoryOpen && !entityContext && (event.code === 'KeyT' || event.code === 'Slash')) {
        event.preventDefault()
        onChatInputChange(event.code === 'Slash' ? '/' : '')
        onChatOpen()
        return
      }
      if (!inventoryOpen && !entityContext && /^Digit[1-9]$/.test(event.code)) {
        event.preventDefault()
        selectHotbar(Number(event.code.slice(-1)) - 1)
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
  }, [
    showChat,
    openingBlock,
    inventoryOpen,
    entityContext,
    onChatInputChange,
    onChatOpen,
    selectHotbar,
    buildMode,
    miningActive,
    pickingChests,
    following,
    updatePathfinder,
  ])

  return (
    <div className="relative min-h-0 min-w-0 flex-1 bg-neutral-950 text-neutral-100">
      <Surroundings3D
        onBlockInteract={interactBlock}
        movementEnabled={!paused && !openingBlock && !inventoryOpen && !showChat && !entityContext && !trader}
        blocks={worldView?.blocks ?? null}
        chests={snapshot.mining?.chests ?? []}
        onBlockPick={pickingChests ? pickChest : null}
        onHover={setHover}
        onEntityContext={(entity, position) => setEntityContext({ entity, position })}
        buildMode={buildMode}
        heldBlock={(() => {
          const held = worldView?.inventory.hotbar[worldView.inventory.selectedHotbar]
          return held?.placeable ? held.name : null
        })()}
        onBuild={build}
        onCloseChat={showChat ? onChatClose : undefined}
        onHotbarScroll={(step) => selectHotbar(((worldView?.inventory.selectedHotbar ?? 0) + step + 9) % 9)}
        queuedBuild={queuedBuild}
        onWalkTo={(target) => {
          if (target.door) setBlockFeedback('Going to the door…')
          updatePathfinder({
            followEnabled: false,
            followTarget: pathfinder.followTarget,
            goToLocation: target,
          })
        }}
        botHands={{
          main: worldView?.inventory.hotbar[worldView.inventory.selectedHotbar] ?? null,
          off: worldView?.inventory.offhand ?? null,
        }}
        botArmor={
          worldView
            ? [
                worldView.inventory.armor.head,
                worldView.inventory.armor.torso,
                worldView.inventory.armor.legs,
                worldView.inventory.armor.feet,
              ]
            : undefined
        }
        className="absolute inset-0 h-full w-full"
      />
      <div className="pointer-events-none absolute inset-0">
        {pickingChests ? (
          <div
            className="pointer-events-auto absolute left-1/2 top-15 z-20 flex -translate-x-1/2 items-center
              gap-3 rounded-lg border border-amber-400/40 bg-neutral-950/85 px-3 py-2 text-xs text-amber-100
              backdrop-blur-xl"
          >
            <span>
              Click chests or barrels to store Auto Mine loot in ({snapshot.mining?.chests.length ?? 0}{' '}
              picked)
            </span>
            <button
              type="button"
              onClick={() => setPickingChests(false)}
              className="rounded-md border border-amber-400/50 px-2 py-0.5 font-semibold
                hover:bg-amber-400/10"
            >
              Done
            </button>
          </div>
        ) : null}
        <div className="pointer-events-auto absolute left-3 top-15 w-64">
          <VitalBars
            health={snapshot.health}
            food={snapshot.food}
            saturation={snapshot.saturation}
            oxygen={snapshot.oxygen}
            underwater={snapshot.underwater}
            autoEat={autoEat}
            eating={snapshot.eating}
            effects={snapshot.effects}
          />
        </div>
        {buildMode ? (
          <div
            role="status"
            className="absolute left-1/2 top-15 flex -translate-x-1/2 items-center gap-2.5 rounded-full border
              border-sky-400/30 bg-neutral-950/75 py-1.5 pl-2 pr-3.5 text-xs text-neutral-300 shadow-lg
              backdrop-blur-xl"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-400/15 text-sky-300">
              <Hammer aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <span className="font-semibold text-sky-100">Build mode</span>
            <span className="text-neutral-500">
              <kbd className="font-sans text-neutral-300">Left</kbd> break ·{' '}
              <kbd className="font-sans text-neutral-300">Right</kbd> place ·{' '}
              <span className="text-neutral-400">drag for a line</span> ·{' '}
              <kbd className="font-sans text-neutral-300">Middle drag</kbd> turn ·{' '}
              <kbd className="rounded border border-white/15 px-1 font-sans text-[10px] text-neutral-300">
                B
              </kbd>{' '}
              exit
            </span>
          </div>
        ) : null}
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
        <div className="pointer-events-auto absolute bottom-12 left-1/2 -translate-x-1/2">
          <Hotbar
            items={worldView?.inventory.hotbar ?? []}
            selected={worldView?.inventory.selectedHotbar ?? 0}
            onSelect={selectHotbar}
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
            <span className="flex max-w-[45%] items-center gap-2 rounded-md bg-neutral-950/80 px-2.5 py-1.5">
              <span className="truncate text-sky-300">{snapshot.mining.status}</span>
              <span className="shrink-0 text-neutral-500">
                <kbd className="rounded border border-white/15 px-1 font-sans text-[10px] text-neutral-300">
                  Esc
                </kbd>{' '}
                stop
              </span>
            </span>
          ) : null}
        </div>
      </div>
      {blockFeedback || following ? (
        <div
          role="status"
          className="absolute bottom-28 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg
            border border-white/10 bg-neutral-900/80 px-4 py-2 text-xs backdrop-blur-xl"
        >
          {blockFeedback ?? (
            <>
              <span>Following {following}</span>
              <span className="text-neutral-500">
                <kbd className="rounded border border-white/15 px-1 font-sans text-[10px] text-neutral-300">
                  Esc
                </kbd>{' '}
                stop
              </span>
            </>
          )}
        </div>
      ) : null}
      {inventoryOpen && !showChat ? (
        <InventoryPage
          key={worldView?.inventory.window?.id ?? 0}
          inventory={worldView?.inventory ?? null}
          onClose={closePage}
        />
      ) : null}
      {entityContext && !inventoryOpen && !showChat ? (
        <EntityPopover
          key={`${entityContext.entity.id}:${entityContext.position.x}:${entityContext.position.y}`}
          entity={entityContext.entity}
          position={entityContext.position}
          onClose={closeEntityContext}
          onTrade={(trades) => {
            setTrader({ title: prettyName(entityContext.entity.type ?? entityContext.entity.name), trades })
            setEntityContext(null)
          }}
        />
      ) : null}
      {tabOpen && !inventoryOpen && !showChat && !trader ? <TabPanel /> : null}
      {trader && !showChat ? (
        <TradePanel
          title={trader.title}
          trades={trader.trades}
          onTradesChange={(trades) => setTrader((current) => (current ? { ...current, trades } : current))}
          onClose={closeTrader}
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
        hidden={inventoryOpen || Boolean(entityContext) || Boolean(trader)}
      />
    </div>
  )
}

export default Dashboard
