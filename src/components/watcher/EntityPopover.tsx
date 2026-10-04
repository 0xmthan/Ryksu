import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Swords, UserRound, Footprints, Store, X } from 'lucide-react'
import type { MotionEntity, TradeOffer } from '../../types'
import { prettyName } from '../../utils/blockColors'

type Props = {
  entity: MotionEntity
  position: { x: number; y: number }
  onClose: () => void
  // Called with the offers once the bot has walked over and opened the trader.
  onTrade: (trades: TradeOffer[]) => void
}

const TRADERS = new Set(['villager', 'wandering_trader'])

const EntityPopover: React.FC<Props> = ({ entity: initialEntity, position, onClose, onTrade }) => {
  const panel = useRef<HTMLDivElement>(null)
  const pending = useRef(false)
  const [entity, setEntity] = useState(initialEntity)
  const [distance, setDistance] = useState<number | null>(null)
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  // Owners the bot couldn't name are looked up through Mojang, which only knows online-mode UUIDs
  // (version 4; offline-mode ones are version 3).
  const [ownerName, setOwnerName] = useState<string | null>(null)
  const ownerUuid = entity.owner && !entity.owner.name && entity.owner.uuid[12] === '4' ? entity.owner.uuid : null
  useEffect(() => {
    if (!ownerUuid) return
    let cancelled = false
    window.electronAPI.bot.lookupPlayerName(ownerUuid).then((name) => {
      if (!cancelled) setOwnerName(name)
    })
    return () => {
      cancelled = true
    }
  }, [ownerUuid])
  const [placement, setPlacement] = useState({ left: Math.max(8, position.x), top: Math.max(56, position.y) })

  useEffect(
    () =>
      window.electronAPI.bot.onMotion((motion) => {
        const current = motion.entities.find((candidate) => candidate.id === initialEntity.id)
        setGone(!current || Boolean(current.dead))
        if (!current) return
        setEntity(current)
        setDistance(Math.hypot(current.x - motion.bot.x, current.y - motion.bot.y, current.z - motion.bot.z))
      }),
    [initialEntity.id]
  )

  useEffect(() => {
    const reposition = () => {
      const rect = panel.current?.getBoundingClientRect()
      if (!rect) return
      setPlacement({
        left: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)),
        top: Math.max(56, Math.min(position.y, window.innerHeight - rect.height - 8)),
      })
    }
    reposition()
    window.addEventListener('resize', reposition)
    return () => window.removeEventListener('resize', reposition)
  }, [position, feedback])

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) onClose()
    }
    window.addEventListener('pointerdown', dismiss)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
    }
  }, [onClose])

  const trader = TRADERS.has(entity.type ?? '')
  const act = useCallback(async (action: 'fight' | 'follow' | 'trade') => {
    if (pending.current || gone || entity.dead || entity.kind === 'item') return
    if (action === 'trade' && !trader) return
    pending.current = true
    setBusy(true)
    setFeedback(action === 'trade' ? 'Walking to the trader…' : null)
    try {
      if (action === 'trade') {
        const response = await window.electronAPI.bot.openTrader(entity.id)
        if (response.ok && response.trades) onTrade(response.trades)
        else setFeedback(response.message ?? 'Could not open the trades.')
        return
      }
      const response = await (action === 'fight'
        ? window.electronAPI.bot.attackEntity(entity.id)
        : window.electronAPI.bot.followEntity(entity.id))
      if (response.ok) onClose()
      else setFeedback(response.message ?? 'Could not perform that action.')
    } catch {
      setFeedback('Action failed. Try again.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }, [entity.id, entity.kind, entity.dead, gone, onClose, onTrade, trader])
  useEffect(() => { panel.current?.focus() }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.code === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
      } else if (event.code === 'KeyF' || event.code === 'KeyG' || (event.code === 'KeyT' && trader)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        act(event.code === 'KeyF' ? 'fight' : event.code === 'KeyG' ? 'follow' : 'trade')
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [act, onClose, trader])
  const gear = Object.entries(entity.equipment ?? {})
  const actionable = !gone && !busy && entity.kind !== 'item' && !entity.dead

  return (
    <div
      ref={panel}
      role="dialog"
      tabIndex={-1}
      aria-label={`Info about ${entity.name}`}
      style={placement}
      className="fixed z-50 w-64 rounded-2xl border border-white/15 bg-neutral-950/70 p-4 text-xs
        text-neutral-300 shadow-2xl outline-none backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-sky-300">
            <UserRound className="h-4 w-4" />
            {prettyName(entity.kind)}
          </div>
          <h2 className="truncate text-sm font-semibold text-white" title={entity.name}>
            {entity.kind === 'player' ? entity.name : prettyName(entity.name)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close entity info"
          className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="my-3 space-y-1.5">
        <div className="flex justify-between gap-2">
          <dt>Position</dt>
          <dd className="font-mono text-neutral-100">
            {Math.floor(entity.x)} / {Math.floor(entity.y)} / {Math.floor(entity.z)}
          </dd>
        </div>
        {distance !== null ? (
          <div className="flex justify-between">
            <dt>Distance</dt>
            <dd>{distance.toFixed(1)} blocks</dd>
          </div>
        ) : null}
        {entity.health !== undefined ? (
          <div className="flex justify-between">
            <dt>Health</dt>
            <dd>{entity.health.toFixed(1)}</dd>
          </div>
        ) : null}
        {entity.tamed ? (
          <div className="flex justify-between gap-2">
            <dt>{entity.owner ? 'Owner' : 'Tamed'}</dt>
            <dd className="flex min-w-0 items-center gap-1.5 text-neutral-100">
              {entity.owner ? (
                <>
                  {entity.owner.source === 'online' ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" title="Online now" />
                  ) : null}
                  <span
                    className={`truncate ${entity.owner.name || ownerName ? '' : 'text-neutral-400'}`}
                    title={`${
                      entity.owner.source === 'seen'
                        ? 'Seen on this server before'
                        : entity.owner.source === 'matched'
                          ? 'Matched from their offline-mode UUID'
                          : entity.owner.name || ownerName
                            ? 'Online now'
                            : 'Never seen; name unknown'
                    }\n${entity.owner.uuid}`}
                  >
                    {entity.owner.name ?? ownerName ?? `Unknown · ${entity.owner.uuid.slice(0, 8)}`}
                  </span>
                  {entity.owner.source === 'seen' || entity.owner.source === 'matched' ? (
                    <span className="shrink-0 text-[0.6rem] text-neutral-500">
                      {entity.owner.source === 'seen' ? 'offline' : 'matched'}
                    </span>
                  ) : null}
                </>
              ) : (
                'Yes'
              )}
            </dd>
          </div>
        ) : null}
        {entity.ping !== undefined ? (
          <div className="flex justify-between">
            <dt>Ping</dt>
            <dd>{Math.round(entity.ping)} ms</dd>
          </div>
        ) : null}
        {entity.sleeping != null || entity.crouching || entity.sitting ? (
          <div className="text-neutral-400">
            {entity.sleeping != null ? 'Sleeping' : entity.sitting ? 'Sitting' : 'Sneaking'}
          </div>
        ) : null}
      </dl>
      {gear.length ? (
        <div className="mb-3 border-t border-white/10 pt-2">
          <span className="text-neutral-500">Equipment</span>
          <div className="mt-1 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {gear.map(([slot, item]) => (
              <span
                key={slot}
                title={prettyName(slot)}
                className="rounded bg-white/5 px-1.5 py-1 text-[10px]"
              >
                {prettyName(item.name)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {gone ? <p className="mb-2 text-neutral-400">Entity is no longer nearby.</p> : null}
      {entity.kind !== 'item' ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!actionable}
            onClick={() => act('fight')}
            aria-keyshortcuts="F"
            className="flex items-center justify-center gap-2 rounded-lg border border-rose-400/30
              bg-rose-500/10 py-2 text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
          >
            <Swords className="h-4 w-4" />
            Fight <kbd className="rounded border border-white/15 px-1 text-[10px] opacity-60">F</kbd>
          </button>
          <button
            type="button"
            disabled={!actionable}
            onClick={() => act('follow')}
            aria-keyshortcuts="G"
            className="flex items-center justify-center gap-2 rounded-lg border border-sky-400/30
              bg-sky-500/10 py-2 text-sky-200 hover:bg-sky-500/20 disabled:opacity-40"
          >
            <Footprints className="h-4 w-4" />
            Follow <kbd className="rounded border border-white/15 px-1 text-[10px] opacity-60">G</kbd>
          </button>
          {trader ? (
            <button
              type="button"
              disabled={!actionable}
              onClick={() => act('trade')}
              aria-keyshortcuts="T"
              className="col-span-2 flex items-center justify-center gap-2 rounded-lg border border-emerald-400/30
                bg-emerald-500/10 py-2 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
            >
              <Store className="h-4 w-4" />
              Trade <kbd className="rounded border border-white/15 px-1 text-[10px] opacity-60">T</kbd>
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-neutral-400">{prettyName(entity.item ?? entity.name)}</p>
      )}
      {feedback ? (
        <p role="status" className={`mt-2 ${busy ? 'text-neutral-400' : 'text-rose-300'}`}>
          {feedback}
        </p>
      ) : null}
    </div>
  )
}

export default EntityPopover
