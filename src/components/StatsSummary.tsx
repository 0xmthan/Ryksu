import React from 'react'

import type { BotStatus, BotSnapshot } from '../types/bot'

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

type StatsSummaryProps = {
  snapshot: ConnectedSnapshot
  status: BotStatus
}

const StatsSummary: React.FC<StatsSummaryProps> = ({ snapshot, status }) => {
  return (
    <section
      className="rounded-2xl border border-purple-900/45 bg-panel p-3 text-xs shadow-panel backdrop-blur sm:text-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-purple-100 sm:text-base">Bot Status</span>
          {status?.message ? (
            <span className="text-purple-200/70">{status.message}</span>
          ) : (
            <span className="text-purple-200/60">Monitoring your bot in real time.</span>
          )}
        </div>
        <span
          className="inline-flex items-center gap-2 rounded-full border border-purple-500/40 bg-purple-800/25
            px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-purple-200"
        >
          {status?.stage ?? 'connected'}
        </span>
      </header>
      <dl className="mt-3 grid gap-y-2">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-purple-200/70 uppercase tracking-[0.2em] text-[0.6rem] sm:text-xs">Health</dt>
          <dd className="font-semibold text-purple-100">{snapshot.health.toFixed(1)} / 20</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-purple-200/70 uppercase tracking-[0.2em] text-[0.6rem] sm:text-xs">Hunger</dt>
          <dd className="font-semibold text-purple-100">{snapshot.food.toFixed(1)} / 20</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-purple-200/70 uppercase tracking-[0.2em] text-[0.6rem] sm:text-xs">Saturation</dt>
          <dd className="font-semibold text-purple-100">{snapshot.saturation.toFixed(2)}</dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <dt className="text-purple-200/70 uppercase tracking-[0.2em] text-[0.6rem] sm:text-xs">Position</dt>
          <dd className="font-mono text-purple-100 sm:text-sm">
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
