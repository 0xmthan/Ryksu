// Server list ping for the connection screen: the server's icon, MOTD, player count and version, like the
// multiplayer menu shows them, fetched without joining.
const mc = require('minecraft-protocol')
const loadPrismarineChat = require('prismarine-chat')

const PING_TIMEOUT_MS = 5000

let ChatMessage = null

// The MOTD arrives as plain text with § codes or as a chat component; both become a § string.
const motdToText = (description) => {
  if (typeof description === 'string') return description
  if (!description || typeof description !== 'object') return ''
  try {
    ChatMessage ??= loadPrismarineChat(mc.defaultVersion)
    return new ChatMessage(description).toMotd()
  } catch {
    return typeof description.text === 'string' ? description.text : ''
  }
}

const pingServer = async ({ host, port } = {}) => {
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
        latency: result.latency ?? null,
      }
    }
    const favicon = typeof result.favicon === 'string' && result.favicon.startsWith('data:image/') ? result.favicon : null
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
            sample: (result.players.sample ?? []).map((player) => player?.name).filter((name) => typeof name === 'string'),
          }
        : null,
      latency: Number.isFinite(result.latency) ? result.latency : null,
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error?.code === 'ENOTFOUND'
          ? 'Server not found.'
          : error?.message === 'ETIMEDOUT'
            ? "The server didn't respond."
            : "Can't reach the server.",
    }
  }
}

module.exports = { pingServer }
