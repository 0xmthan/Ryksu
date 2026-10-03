import React from 'react'
import type { BotSnapshot } from '../types'

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

type StatsSummaryProps = {
  snapshot: ConnectedSnapshot
}

const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-2">
    <dt className="text-[0.6rem] uppercase tracking-[0.16em] text-neutral-500">{label}</dt>
    <dd className="font-semibold text-neutral-100">{children}</dd>
  </div>
)

const StatsSummary: React.FC<StatsSummaryProps> = ({ snapshot }) => {
  const positionLabel = snapshot.position
    ? `${Math.round(snapshot.position.x)} / ${Math.round(snapshot.position.y)} / ${Math.round(
        snapshot.position.z
      )}`
    : 'Waiting for spawn…'

  const xpLevel = snapshot.xp?.level ?? 0
  const xpPercent = Math.round(Math.max(0, Math.min(1, snapshot.xp?.progress ?? 0)) * 100)
  const pingLabel = snapshot.ping != null ? `${Math.round(snapshot.ping)} ms` : '—'

  return (
    <section
      className="rounded-xl border border-neutral-800 bg-neutral-900/90 px-3 py-2.5 text-xs text-neutral-300
        shadow-lg backdrop-blur"
    >
      <header className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-neutral-400">
        Bot Vitals
      </header>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">
        <Stat label="HP">{snapshot.health.toFixed(1)}</Stat>
        <Stat label="Food">{snapshot.food.toFixed(0)}</Stat>
        <Stat label="Sat">{snapshot.saturation.toFixed(1)}</Stat>
        <Stat label="XP">
          {xpLevel} · {xpPercent}%
        </Stat>
        <Stat label="Ping">{pingLabel}</Stat>
      </dl>
      <div className="mt-1.5 truncate font-mono text-neutral-200" title="Position (x / y / z)">
        {positionLabel}
      </div>
    </section>
  )
}

export default StatsSummary
