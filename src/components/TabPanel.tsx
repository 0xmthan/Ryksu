import React, { useEffect, useState } from 'react'
import type { PlayerList } from '../types'
import PlayerHead from './PlayerHead'

const REFRESH_MS = 1000
// Plenty for a glance; the rest are summed up.
const MAX_OFFLINE = 48

const ago = (time: number | null, now: number) => {
  if (!time) return 'a while ago'
  const minutes = Math.floor((now - time) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`
}

// The game's connection bars: more and greener the lower the ping.
const PingBars: React.FC<{ ping: number | null }> = ({ ping }) => {
  const bars = ping == null ? 0 : ping < 150 ? 4 : ping < 300 ? 3 : ping < 600 ? 2 : 1
  const color =
    bars >= 4 ? 'bg-emerald-400' : bars === 3 ? 'bg-lime-300' : bars === 2 ? 'bg-amber-300' : 'bg-rose-400'
  return (
    <span
      className="flex items-end gap-[2px]"
      title={ping == null ? 'Ping unknown' : `${Math.round(ping)} ms`}
    >
      {[4, 6, 8, 10].map((height, index) => (
        <span
          key={height}
          className={`w-[3px] rounded-[1px] ${index < bars ? color : 'bg-white/10'}`}
          style={{ height }}
        />
      ))}
    </span>
  )
}

// Held open with Tab, like the game's player list, plus the players remembered on this server.
const TabPanel: React.FC = () => {
  const [list, setList] = useState<PlayerList | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      window.electronAPI.bot.getPlayerList().then((next) => {
        if (cancelled) return
        setList(next)
        setNow(Date.now())
      })
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const offline = list?.offline.slice(0, MAX_OFFLINE) ?? []
  const hidden = (list?.offline.length ?? 0) - offline.length

  return (
    <div
      // Not a dialog: movement keys stay live while it's held open.
      role="region"
      aria-label="Player list"
      className="pointer-events-none fixed left-1/2 top-16 z-40 flex max-h-[calc(100%-96px)]
        w-[min(420px,calc(100%-32px))] -translate-x-1/2 flex-col rounded-2xl border border-white/10
        bg-neutral-950/75 text-xs text-neutral-300 shadow-[0_20px_70px_#0009] backdrop-blur-2xl"
    >
      <header className="flex items-baseline justify-between border-b border-white/5 px-3 py-2">
        <span className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-neutral-400">
          Players
        </span>
        <span className="text-[0.65rem] text-neutral-500">
          <span className="text-emerald-300">{list?.online.length ?? 0} online</span>
          {list?.offline.length ? ` · ${list.offline.length} offline` : ''}
        </span>
      </header>

      <div className="overflow-y-auto p-1.5">
        <ul className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
          {list?.online.map((player) => (
            <li
              key={player.uuid}
              className="flex items-center gap-1.5 rounded-md bg-white/[0.04] px-1.5 py-1"
            >
              <PlayerHead name={player.name} size={16} />
              <span className="min-w-0 flex-1 truncate text-neutral-100">{player.name}</span>
              {player.bot ? (
                <span
                  className="rounded bg-sky-400/15 px-1 text-[0.55rem] font-semibold tracking-wider
                    text-sky-300"
                >
                  BOT
                </span>
              ) : null}
              <PingBars ping={player.ping} />
            </li>
          ))}
        </ul>

        {offline.length ? (
          <>
            <div
              className="mt-2 mb-0.5 px-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.18em]
                text-neutral-600"
            >
              Offline
            </div>
            <ul className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
              {offline.map((player) => (
                <li key={player.uuid} className="flex items-center gap-1.5 px-1.5 py-0.5">
                  <PlayerHead name={player.name} size={16} className="opacity-50 grayscale" />
                  <span className="min-w-0 flex-1 truncate text-neutral-400">{player.name}</span>
                  <span className="shrink-0 text-[0.6rem] text-neutral-600">{ago(player.lastSeen, now)}</span>
                </li>
              ))}
            </ul>
            {hidden > 0 ? (
              <p className="px-1.5 pt-1 text-[0.6rem] text-neutral-600">and {hidden} more</p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

export default TabPanel
