// A small HTTP API for driving the running app from a terminal (curl, scripts, an agent): turned on in
// Settings → Developer, and only reachable from this computer (127.0.0.1). Port: RYKSU_CONTROL_PORT, or 47615.
//
//   GET  /state                  where the bot is, what it's doing, health, the pathfinder's goal
//   GET  /events?since=<id>      recent pathfinder/mining/chat events, for following along
//   GET  /chat                   chat history
//   GET  /block?x=&y=&z=         a block's name, hitbox and light
//   GET  /frames                 item frames near the bot as the watcher gets them, and the maps known
//   GET  /settings               the saved settings, locations, … by key (never passwords or tokens)
//   POST /connect                connect with the saved connection details (like the Connect button)
//   POST /disconnect
//   POST /chat      {"text"}     say something or run a command
//   POST /goto      {"x","y","z"}  walk somewhere (like the Go To button)
//   POST /stop                   stop walking, mining and fighting
//   POST /mining/start {"ores","blocks"} · POST /mining/stop
//   GET  /scripts                the scripts, which is on, and their log
//   POST /scripts/save {"id"?,"name","code"} · POST /scripts/start {"id"} · POST /scripts/stop
import type { BrowserWindow } from 'electron'
import http from 'node:http'
import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { ControlApiStatus } from '../shared/ipc'
import type { BotManager } from './bot/botManager'
import { loadWindowStore } from './storage/appStore'
import { getItemFrames, knownMaps } from './bot/entities/itemFrames'

type ControlEvent = { id: number; at: number; type: string; detail: unknown }

const MAX_EVENTS = 500

const round = (value: number) => Math.round(value * 100) / 100

export const CONTROL_API_PORT = Number(process.env.RYKSU_CONTROL_PORT) || 47615

// Events are recorded from creation, so turning the API on shows what led up to it too.
export const createControlApi = (botManager: BotManager, getWindow: () => BrowserWindow | null) => {
  const port = CONTROL_API_PORT
  const events: ControlEvent[] = []
  let nextId = 1
  const record = (type: string, detail: unknown) => {
    events.push({ id: nextId++, at: Date.now(), type, detail })
    if (events.length > MAX_EVENTS) events.shift()
  }

  // Follow the current bot's pathfinder; a new bot (reconnect) gets hooked up on the next request or event.
  let watched: Bot | null = null
  const watch = () => {
    const bot = botManager.bot
    if (!bot || bot === watched) return
    watched = bot
    bot.on(
      'path_update' as never,
      ((result: { status: string; path: unknown[] }) =>
        record('path_update', { status: result.status, length: result.path.length })) as never
    )
    bot.on('path_reset' as never, ((reason: string) => record('path_reset', reason)) as never)
    bot.on('goal_reached' as never, (() => record('goal_reached', null)) as never)
    bot.on('path_stop' as never, (() => record('path_stop', null)) as never)
    bot.on('death', () => record('death', null))
    bot.on('end', (reason) => record('end', reason))
  }
  botManager.on('chat' as never, ((entry: unknown) => record('chat', entry)) as never)
  botManager.on('miningStopped' as never, ((reason: string) => record('mining_stopped', reason)) as never)
  botManager.on('notice' as never, ((text: string) => record('notice', text)) as never)
  botManager.on(
    'status' as never,
    ((status: unknown) => {
      record('status', status)
      watch()
    }) as never
  )

  const state = () => {
    watch()
    const bot = botManager.bot
    if (!bot?.entity) return { connected: Boolean(bot), inWorld: false }
    const { x, y, z } = bot.entity.position
    const goal = bot.pathfinder?.goal as unknown as Record<string, unknown> | null
    return {
      connected: true,
      inWorld: true,
      username: bot.username,
      position: { x: round(x), y: round(y), z: round(z) },
      onGround: bot.entity.onGround,
      dimension: bot.game?.dimension,
      health: bot.health,
      food: bot.food,
      pathfinder: bot.pathfinder
        ? {
            goal: goal ? { type: goal.constructor?.name, ...pickCoords(goal) } : null,
            moving: bot.pathfinder.isMoving(),
            digging: bot.pathfinder.isMining(),
            building: bot.pathfinder.isBuilding(),
          }
        : null,
      mining: botManager.getSnapshot()?.mining ?? null,
    }
  }

  // The window's saves, parsed, with the saved server password left out.
  const settings = () =>
    Object.fromEntries(
      Object.entries(loadWindowStore()).map(([key, text]) => {
        const value = JSON.parse(text)
        if (value && typeof value === 'object' && 'offlinePassword' in value) delete value.offlinePassword
        return [key, value]
      })
    )

  const routes: Record<string, (body: Record<string, unknown>, url: URL) => unknown> = {
    'GET /state': () => state(),
    'GET /events': (_body, url) => {
      watch()
      const since = Number(url.searchParams.get('since')) || 0
      return events.filter((event) => event.id > since)
    },
    'GET /chat': () => botManager.getChatHistory(),
    'GET /block': (_body, url) => {
      const bot = botManager.bot
      if (!bot) throw new Error('Not connected.')
      const [x, y, z] = ['x', 'y', 'z'].map((key) => Number(url.searchParams.get(key)))
      const block = bot.blockAt(new Vec3(x, y, z))
      return block
        ? { name: block.name, boundingBox: block.boundingBox, light: block.light, skyLight: block.skyLight }
        : null
    },
    'GET /frames': () => {
      const bot = botManager.bot
      if (!bot?.entity) throw new Error('Not in a world.')
      const nearby = Object.values(bot.entities).filter(
        (entity) => entity !== bot.entity && entity.position.distanceTo(bot.entity.position) < 80
      )
      const names: Record<string, number> = {}
      for (const entity of nearby) names[String(entity.name)] = (names[String(entity.name)] ?? 0) + 1
      return {
        entityNames: names,
        frames: getItemFrames(bot),
        rawFrames: nearby
          .filter((entity) => entity.name?.endsWith('item_frame'))
          .slice(0, 3)
          .map((entity) => ({ id: entity.id, position: entity.position, metadata: entity.metadata })),
        maps: knownMaps(bot),
      }
    },
    'GET /settings': () => settings(),
    'POST /connect': async () => {
      const window = getWindow()
      if (!window) throw new Error('No window.')
      await window.webContents.executeJavaScript('window.__ryksuConnect?.()', true)
      return { ok: true }
    },
    'POST /disconnect': () => botManager.disconnect(),
    'POST /chat': (body) => botManager.sendChat(body.text),
    'POST /goto': (body) => {
      const [x, y, z] = [body.x, body.y, body.z].map(Number)
      if (![x, y, z].every(Number.isFinite)) throw new Error('x, y and z are required.')
      record('control', { goto: { x, y, z } })
      return botManager.setPathfinderOptions({ goToLocation: { x, y, z } })
    },
    'POST /stop': () => {
      botManager.stopMining()
      return botManager.setPathfinderOptions({ cancelGoTo: true, followEnabled: false })
    },
    'GET /scripts': () => botManager.scripts.getState(),
    'POST /scripts/save': (body) => botManager.scripts.save(body),
    'POST /scripts/start': async (body) => {
      await botManager.scripts.start(body.id)
      return botManager.scripts.getState().running
    },
    'POST /scripts/stop': async () => {
      await botManager.scripts.stop()
      return { ok: true }
    },
    'POST /mining/start': (body) => botManager.startMining(body),
    'POST /mining/stop': () => botManager.stopMining(),
  }

  const handle = (request: http.IncomingMessage, response: http.ServerResponse) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    const route = routes[`${request.method} ${url.pathname}`]
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', async () => {
      const reply = (status: number, value: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(value ?? null, null, 2))
      }
      if (!route) return reply(404, { error: `No route ${request.method} ${url.pathname}` })
      try {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        reply(200, await route(body, url))
      } catch (error) {
        reply(400, { error: (error as Error)?.message ?? String(error) })
      }
    })
  }

  let server: http.Server | null = null
  let error: string | null = null
  const status = (): ControlApiStatus => ({ enabled: Boolean(server), port, error })

  // Resolves once listening (or failed to: the port is taken, say), with the status either way.
  const start = () =>
    new Promise<ControlApiStatus>((resolve) => {
      if (server) return resolve(status())
      const next = http.createServer(handle)
      next.once('error', (cause: NodeJS.ErrnoException) => {
        error = cause.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : cause.message
        console.error('[Control] Could not start', cause)
        resolve(status())
      })
      next.listen(port, '127.0.0.1', () => {
        server = next
        error = null
        console.log(`[Control] Listening on http://127.0.0.1:${port}`)
        resolve(status())
      })
    })

  const stop = () =>
    new Promise<ControlApiStatus>((resolve) => {
      const current = server
      server = null
      error = null
      if (!current) return resolve(status())
      current.closeAllConnections()
      current.close(() => resolve(status()))
    })

  return { start, stop, status }
}

const pickCoords = (goal: Record<string, unknown>) => {
  const coords: Record<string, unknown> = {}
  for (const key of ['x', 'y', 'z']) if (typeof goal[key] === 'number') coords[key] = goal[key]
  const pos = goal.pos ?? goal.target
  if (pos && typeof pos === 'object') Object.assign(coords, pickCoords(pos as Record<string, unknown>))
  return coords
}
