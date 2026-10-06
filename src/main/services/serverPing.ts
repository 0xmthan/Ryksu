// Server list ping for the connection screen: the server's icon, MOTD, player count and version, like the
// multiplayer menu shows them, fetched without joining.
import mc from 'minecraft-protocol'
import loadPrismarineChat from 'prismarine-chat'
import type { ServerPing } from '../../shared/types'

const PING_TIMEOUT_MS = 5000

let ChatMessage: ReturnType<typeof loadPrismarineChat> | null = null

// The MOTD arrives as plain text with § codes or as a chat component; both become a § string.
const motdToText = (description: unknown) => {
  if (typeof description === 'string') return description
  if (!description || typeof description !== 'object') return ''
  try {
    ChatMessage ??= loadPrismarineChat(mc.defaultVersion)
    return new ChatMessage(description as never).toMotd()
  } catch {
    const text = (description as { text?: unknown }).text
    return typeof text === 'string' ? text : ''
  }
}

// `target` comes from the renderer, so its fields are checked here.
export const pingServer = async ({
  host,
  port,
}: { host?: unknown; port?: unknown } = {}): Promise<ServerPing> => {
  const trimmedHost = typeof host === 'string' ? host.trim() : ''
  if (!trimmedHost) {
    return { ok: false, message: 'No host set.' }
  }

  try {
    const result = await mc.ping({
      host: trimmedHost,
      port: port ? Number(port) : undefined,
      closeTimeout: PING_TIMEOUT_MS,
    })
    // Pre-1.7 servers answer with a different shape that has no icon or rich MOTD.
    if ('maxPlayers' in result) {
      return {
        ok: true,
        motd: result.motd ?? '',
        favicon: null,
        version: result.version ?? null,
        players: { online: result.playerCount, max: result.maxPlayers, sample: [] },
        latency: (result as { latency?: number }).latency ?? null,
      }
    }
    const favicon =
      typeof result.favicon === 'string' && result.favicon.startsWith('data:image/') ? result.favicon : null
    return {
      ok: true,
      motd: motdToText(result.description),
      favicon,
      version: result.version?.name ?? null,
      players: result.players
        ? {
            online: result.players.online,
            max: result.players.max,
            // Some players the server chose to list; many servers put text lines here instead.
            sample: (result.players.sample ?? [])
              .map((player) => player?.name)
              .filter((name): name is string => typeof name === 'string'),
          }
        : null,
      latency: Number.isFinite(result.latency) ? result.latency : null,
    }
  } catch (error) {
    const failure = error as { code?: string; message?: string } | undefined
    return {
      ok: false,
      message:
        failure?.code === 'ENOTFOUND'
          ? 'Server not found.'
          : failure?.message === 'ETIMEDOUT'
            ? "The server didn't respond."
            : "Can't reach the server.",
    }
  }
}
