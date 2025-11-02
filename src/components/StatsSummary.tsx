import React from 'react'
import type { BotSnapshot } from '../types'

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

type StatsSummaryProps = {
  snapshot: ConnectedSnapshot
}

const StatsSummary: React.FC<StatsSummaryProps> = ({ snapshot }) => {
  const positionLabel = snapshot.position
    ? `${Math.round(snapshot.position.x)} / ${Math.round(snapshot.position.y)} / ${Math.round(
        snapshot.position.z
      )}`
    : 'Waiting for spawn…'

  const xpLevel = snapshot.xp?.level ?? 0
  const xpProgress = snapshot.xp?.progress ?? 0
  const xpPoints = snapshot.xp?.points ?? 0
  const xpPercent = Math.round(Math.max(0, Math.min(1, xpProgress)) * 100)
  const pingLabel = snapshot.ping != null ? `${Math.round(snapshot.ping)} ms` : '—'

  return (
    <section
      className="w-full max-w-xs rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 text-xs
        text-neutral-300 shadow-md sm:w-72 sm:text-sm"
    >
      <header className="flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-100 sm:text-base">Bot Vitals</span>
      </header>
      <dl className="mt-3 space-y-3 text-neutral-200">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-500 uppercase tracking-[0.18em] text-[0.62rem] sm:text-xs">Health</dt>
          <dd className="font-semibold text-neutral-100">{snapshot.health.toFixed(1)} / 20</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-500 uppercase tracking-[0.18em] text-[0.62rem] sm:text-xs">Hunger</dt>
          <dd className="font-semibold text-neutral-100">{snapshot.food.toFixed(1)} / 20</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-500 uppercase tracking-[0.18em] text-[0.62rem] sm:text-xs">
            Saturation
          </dt>
          <dd className="font-semibold text-neutral-100">{snapshot.saturation.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500 uppercase tracking-[0.18em] text-[0.62rem] sm:text-xs">Position</dt>
          <dd
            className="mt-1 w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-neutral-200
              sm:text-sm"
          >
            {positionLabel}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-500 uppercase tracking-[0.18em] text-[0.62rem] sm:text-xs">XP</dt>
          <dd className="font-semibold text-neutral-100">
            Lv {xpLevel} &middot; {xpPercent}% ({Math.floor(xpPoints)} pts)
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-500 uppercase tracking-[0.18em] text-[0.62rem] sm:text-xs">Ping</dt>
          <dd className="font-semibold text-neutral-100">{pingLabel}</dd>
        </div>
      </dl>
    </section>
  )
}

export default StatsSummary
