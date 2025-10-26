import React from 'react'

import type { BotSnapshot } from '../types/bot'

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

type StatsSummaryProps = {
  snapshot: ConnectedSnapshot
}

const StatsSummary: React.FC<StatsSummaryProps> = ({ snapshot }) => {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 text-xs text-neutral-300 shadow-md sm:text-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-neutral-100 sm:text-base">Bot Vitals</span>
      </header>
      <dl className="mt-3 grid gap-y-2 text-neutral-200">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-500 uppercase tracking-[0.18em] text-[0.62rem] sm:text-xs">Health</dt>
          <dd className="font-semibold text-neutral-100">{snapshot.health.toFixed(1)} / 20</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-500 uppercase tracking-[0.18em] text-[0.62rem] sm:text-xs">Hunger</dt>
          <dd className="font-semibold text-neutral-100">{snapshot.food.toFixed(1)} / 20</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-500 uppercase tracking-[0.18em] text-[0.62rem] sm:text-xs">Saturation</dt>
          <dd className="font-semibold text-neutral-100">{snapshot.saturation.toFixed(2)}</dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <dt className="text-neutral-500 uppercase tracking-[0.18em] text-[0.62rem] sm:text-xs">Position</dt>
          <dd className="font-mono text-neutral-200 sm:text-sm">
            {snapshot.position
              ? `${snapshot.position.x}, ${snapshot.position.y}, ${snapshot.position.z}`
              : 'Waiting for spawn…'}
          </dd>
        </div>
      </dl>
    </section>
  )
}

export default StatsSummary
