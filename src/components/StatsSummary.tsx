import React from 'react'
import type { BotSnapshot } from '../types'
import './vitals.css'

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

type StatsSummaryProps = {
  snapshot: ConnectedSnapshot
}

const StatsSummary: React.FC<StatsSummaryProps> = ({ snapshot }) => {
  const xpLevel = snapshot.xp?.level ?? 0
  const xpPercent = Math.round(Math.max(0, Math.min(1, snapshot.xp?.progress ?? 0)) * 100)

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/90 p-2 text-xs text-neutral-300 shadow-lg backdrop-blur">
      <header className="px-1 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-neutral-400">
        Bot Vitals
      </header>

      <div className="mx-1 flex items-center gap-2" title={`Level ${xpLevel}, ${xpPercent}% to next`}>
        <span className="w-8 font-mono text-[0.7rem] font-bold text-emerald-200">Lv {xpLevel}</span>
        <span className="vitals-track h-1.5 flex-1 overflow-hidden rounded-full">
          <span
            className="vitals-fill-xp block h-full rounded-full transition-[width] duration-500"
            style={{ width: `${xpPercent}%` }}
          />
        </span>
        <span className="font-mono text-[0.6rem] tabular-nums text-neutral-500">{xpPercent}%</span>
      </div>
    </section>
  )
}

export default StatsSummary
