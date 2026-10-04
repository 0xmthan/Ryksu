import React, { useEffect, useRef, useState } from 'react'
import { Swords, UserRound, Footprints, X } from 'lucide-react'
import type { MotionEntity } from '../../types'
import { prettyName } from '../../utils/blockColors'

type Props = {
  entity: MotionEntity
  position: { x: number; y: number }
  onClose: () => void
}

const EntityPopover: React.FC<Props> = ({ entity: initialEntity, position, onClose }) => {
  const panel = useRef<HTMLDivElement>(null)
  const [entity, setEntity] = useState(initialEntity)
  const [distance, setDistance] = useState<number | null>(null)
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
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
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const act = async (action: 'fight' | 'follow') => {
    setBusy(true)
    setFeedback(null)
    try {
      const response = await (action === 'fight'
        ? window.electronAPI.bot.attackEntity(entity.id)
        : window.electronAPI.bot.followEntity(entity.id))
      if (response.ok) onClose()
      else setFeedback(response.message ?? 'Could not perform that action.')
    } catch {
      setFeedback('Action failed. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const gear = Object.entries(entity.equipment ?? {})
  const actionable = !gone && !busy && entity.kind !== 'item' && !entity.dead

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={`Info about ${entity.name}`}
      style={placement}
      className="fixed z-50 w-64 rounded-2xl border border-white/15 bg-neutral-950/70 p-4 text-xs
        text-neutral-300 shadow-2xl backdrop-blur-xl"
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
        {entity.ping !== undefined ? (
          <div className="flex justify-between">
            <dt>Ping</dt>
            <dd>{Math.round(entity.ping)} ms</dd>
          </div>
        ) : null}
        {entity.crouching || entity.sitting ? (
          <div className="text-neutral-400">{entity.sitting ? 'Sitting' : 'Sneaking'}</div>
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
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!actionable}
            onClick={() => act('fight')}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-rose-400/30
              bg-rose-500/10 py-2 text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
          >
            <Swords className="h-4 w-4" />
            Fight
          </button>
          <button
            type="button"
            disabled={!actionable}
            onClick={() => act('follow')}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-sky-400/30
              bg-sky-500/10 py-2 text-sky-200 hover:bg-sky-500/20 disabled:opacity-40"
          >
            <Footprints className="h-4 w-4" />
            Follow
          </button>
        </div>
      ) : (
        <p className="text-neutral-400">{prettyName(entity.item ?? entity.name)}</p>
      )}
      {feedback ? (
        <p role="status" className="mt-2 text-rose-300">
          {feedback}
        </p>
      ) : null}
    </div>
  )
}

export default EntityPopover
