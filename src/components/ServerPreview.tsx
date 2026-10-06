import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Users, Wifi } from 'lucide-react'
import unknownServerIcon from 'minecraft-assets/minecraft-assets/data/26.1/misc/unknown_server.png'
import type { ServerPing } from '../types'
import { parseMotd } from '../utils/motd'

// Wait for typing to settle before pinging a host being edited.
const PING_DELAY_MS = 500

type ServerPreviewProps = {
  host: string
  port: string
}

// One line of § formatted text.
const FormattedLine = ({ value, className }: { value: string; className?: string }) => (
  <span className={`block truncate whitespace-pre ${className ?? ''}`}>
    {parseMotd(value).map((segment, index) => (
      <span
        key={index}
        style={{ color: segment.color ?? undefined }}
        className={[
          segment.bold && 'font-bold',
          segment.italic && 'italic',
          segment.underlined && 'underline',
          segment.strikethrough && 'line-through',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {segment.obfuscated ? segment.text.replace(/\S/g, '▒') : segment.text}
      </span>
    ))}
  </span>
)

// The player count, with the game's purple-bordered tooltip listing the players the server shares.
const PlayerCount = ({ players }: { players: { online: number; max: number; sample: string[] } }) => {
  const hidden = players.online - players.sample.length
  const count = (
    <>
      <Users size={12} aria-hidden="true" />
      {players.online.toLocaleString()} / {players.max.toLocaleString()}
    </>
  )
  if (players.sample.length === 0) {
    return (
      <span className="inline-flex items-center gap-1" title="Players online">
        {count}
      </span>
    )
  }
  return (
    <span
      tabIndex={0}
      aria-describedby="server-player-list"
      className="group relative inline-flex cursor-default items-center gap-1 rounded
        focus-visible:outline-sky-400"
    >
      {count}
      <span
        id="server-player-list"
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden min-w-max max-w-80
          rounded-[3px] border border-[#100010] bg-[#100010f0] px-2 py-1.5 font-mono text-xs leading-5
          text-white shadow-[inset_0_0_0_1px_#5000ff80] group-hover:block group-focus-visible:block"
      >
        {players.sample.map((name, index) => (
          <FormattedLine key={index} value={name} />
        ))}
        {hidden > 0 ? (
          <span className="block text-[#aaaaaa]">… and {hidden.toLocaleString()} more …</span>
        ) : null}
      </span>
    </span>
  )
}

// The server as the multiplayer list shows it: icon, MOTD, players, version and latency.
export default function ServerPreview({ host, port }: ServerPreviewProps) {
  const [result, setResult] = useState<ServerPing | null>(null)
  const [isPinging, setIsPinging] = useState(false)
  const latestRequest = useRef(0)
  const trimmedHost = host.trim()

  const ping = useCallback(async () => {
    const request = ++latestRequest.current
    if (!trimmedHost) {
      setResult(null)
      setIsPinging(false)
      return
    }
    setIsPinging(true)
    let next: ServerPing
    try {
      next = await window.electronAPI.pingServer({ host: trimmedHost, port })
    } catch {
      next = { ok: false, message: "Can't reach the server." }
    }
    // A newer ping started while this one was waiting; its answer wins.
    if (request !== latestRequest.current) return
    setResult(next)
    setIsPinging(false)
  }, [trimmedHost, port])

  useEffect(() => {
    const timer = setTimeout(ping, PING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [ping])

  if (!trimmedHost) return null

  const online = result?.ok ? result : null

  return (
    <section
      aria-label="Server status"
      aria-busy={isPinging}
      className="flex items-center gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3 pr-4
        shadow-lg shadow-black/10"
    >
      <img
        src={online?.favicon ?? unknownServerIcon}
        alt=""
        className="h-16 w-16 shrink-0 rounded-lg [image-rendering:pixelated]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-semibold text-neutral-100">
            {trimmedHost}
            {port ? <span className="text-neutral-500">:{port}</span> : null}
          </p>
          <div className="flex shrink-0 items-center gap-3 text-xs text-neutral-400">
            {online?.players ? <PlayerCount players={online.players} /> : null}
            {online?.latency != null ? (
              <span className="inline-flex items-center gap-1" title="Latency">
                <Wifi size={12} aria-hidden="true" />
                {online.latency} ms
              </span>
            ) : null}
            <button
              type="button"
              onClick={ping}
              disabled={isPinging}
              aria-label="Refresh server status"
              title="Refresh"
              className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-sky-200
                focus-visible:outline-sky-400 disabled:cursor-wait"
            >
              <RefreshCw size={12} aria-hidden="true" className={isPinging ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div
          className="mt-1 font-mono text-xs leading-relaxed text-neutral-400"
          role="status"
          aria-live="polite"
        >
          {online ? (
            <>
              {online.motd
                .split('\n')
                .slice(0, 2)
                .map((line, index) => (
                  <FormattedLine key={index} value={line} />
                ))}
              {online.version ? (
                <span className="mt-0.5 block truncate text-neutral-600">
                  {parseMotd(online.version)
                    .map((segment) => segment.text)
                    .join('')}
                </span>
              ) : null}
            </>
          ) : result && !result.ok ? (
            <span className="text-red-300/80">{result.message}</span>
          ) : (
            <span>Pinging server…</span>
          )}
        </div>
      </div>
    </section>
  )
}
