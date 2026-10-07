import { Notification, type IpcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { BotManager } from '../bot/botManager'
import type {
  EventChannels,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  Result,
  SendChannels,
} from '../../shared/ipc'
import { pingServer } from '../services/serverPing'

let registered = false

const errorMessage = (error: unknown) => (error as Error | undefined)?.message || String(error)

// Runs an action for the window: ok with whatever it returns, or not ok with the message of what it threw.
const attempt = async <T extends object>(action: () => T | void | Promise<T | void>) => {
  try {
    return { ok: true, ...(await action()) } as Result<Partial<T>>
  } catch (error) {
    return { ok: false, message: errorMessage(error) } as Result<Partial<T>>
  }
}

export const registerBotIpc = (ipcMain: IpcMain, botManager: BotManager) => {
  if (registered) {
    return
  }
  registered = true

  // Arguments come from the window as typed in src/shared/ipc.ts, but handlers still check the ones they act on.
  const handle = <C extends InvokeChannel>(
    channel: C,
    handler: (event: IpcMainInvokeEvent, ...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>
  ) => ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)

  const on = <C extends keyof SendChannels>(
    channel: C,
    listener: (event: Electron.IpcMainEvent, ...args: SendChannels[C]) => void
  ) => ipcMain.on(channel, listener as (event: Electron.IpcMainEvent, ...args: unknown[]) => void)

  let activeWebContents: WebContents | null = null

  const setActiveWebContents = (webContents: WebContents) => {
    if (webContents && !webContents.isDestroyed()) {
      activeWebContents = webContents
    }
  }

  const emitToRenderer = <C extends keyof EventChannels>(channel: C, payload: EventChannels[C]) => {
    if (!activeWebContents || activeWebContents.isDestroyed()) {
      return
    }

    activeWebContents.send(channel, payload)
  }

  botManager.on('status', (status) => {
    emitToRenderer('bot:status', status)
  })

  handle('server:ping', (_event, target) => pingServer(target))

  botManager.on('notify', (title, body) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  })

  botManager.on('miningStopped', (reason) => {
    if (Notification.isSupported()) {
      new Notification({ title: 'Auto Mine stopped', body: reason }).show()
    }
  })

  botManager.on('state', (state) => {
    emitToRenderer('bot:state', state)
  })

  botManager.on('world', (view) => {
    emitToRenderer('bot:world', view)
  })

  botManager.on('motion', (motion) => {
    emitToRenderer('bot:motion', motion)
  })

  botManager.on('selfMotion', (motion) => {
    emitToRenderer('bot:selfMotion', motion)
  })

  botManager.on('pathfinderOptions', (options) => {
    emitToRenderer('bot:pathfinderOptions', options)
  })

  // Short results of actions (a door opened, …), shown in the watcher's status bubble.
  botManager.on('notice', (text) => {
    emitToRenderer('bot:notice', text)
  })

  // Blocks the bot is still to break or place in build mode.
  botManager.on('breaking', (state) => {
    emitToRenderer('bot:breaking', state)
  })

  botManager.on('buildCells', (cells) => {
    emitToRenderer('bot:buildCells', cells)
  })

  botManager.on('chat', (entry) => {
    emitToRenderer('bot:chat', entry)
  })

  handle('bot:connect', (event, options) => {
    setActiveWebContents(event.sender)

    return attempt(async () => {
      await botManager.connect(options)
      const snapshot = botManager.getSnapshot()
      if (snapshot) {
        emitToRenderer('bot:state', snapshot)
      }
    })
  })

  handle('bot:disconnect', async () => {
    await botManager.disconnect()
    return { ok: true }
  })

  handle('bot:getSupportedVersions', () => {
    return botManager.getSupportedVersions()
  })

  handle('bot:getChatHistory', () => {
    return botManager.getChatHistory()
  })

  handle('bot:sendChat', (_event, message) => attempt(() => botManager.sendChat(message)))

  handle('bot:useBed', () => attempt(() => botManager.useNearestBed()))

  handle('bot:pickUpBed', () => attempt(() => botManager.pickUpBed()))

  handle('bot:dismissBedPickup', () => {
    botManager.dismissBedPickup()
    return { ok: true }
  })

  handle('bot:startMining', (_event, options) => attempt(() => ({ state: botManager.startMining(options) })))

  handle('bot:stopMining', () => ({ ok: true, state: botManager.stopMining() }))

  handle('bot:getMineableBlocks', () => botManager.getMineableBlocks())

  botManager.on('scripts', (state) => emitToRenderer('scripts:state', state))
  handle('scripts:getState', () => botManager.scripts.getState())
  handle('scripts:save', (_event, script) => attempt(() => ({ script: botManager.scripts.save(script) })))
  handle('scripts:delete', (_event, id) => attempt(() => botManager.scripts.remove(id)))
  handle('scripts:start', (_event, id) => attempt(() => botManager.scripts.start(id)))
  handle('scripts:stop', () => attempt(() => botManager.scripts.stop()))

  handle('bot:toggleMiningChest', (_event, position) => attempt(() => botManager.toggleMiningChest(position)))

  handle('bot:interactBlock', (_event, position) => attempt(() => botManager.interactBlock(position)))

  handle('bot:inventoryAction', (_event, action) => attempt(() => botManager.inventoryAction(action)))

  handle('bot:buildAction', (_event, action) =>
    attempt(async () => ({ message: await botManager.buildAction(action) }))
  )

  handle('bot:cancelBuild', () => ({ ok: true, stopped: botManager.cancelBuild() }))

  handle('bot:openTrader', (_event, entityId) => {
    if (!Number.isInteger(entityId)) return { ok: false, message: 'Invalid entity.' }
    return attempt(async () => ({ trades: await botManager.openTrader(entityId) }))
  })

  handle('bot:trade', (_event, index, count) => {
    if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1) {
      return { ok: false, message: 'Invalid trade.' }
    }
    return attempt(async () => ({ trades: await botManager.trade(index, count) }))
  })

  handle('bot:closeTrader', () => {
    botManager.closeTrader()
    return { ok: true }
  })

  handle('bot:attackEntity', (_event, entityId) =>
    Number.isInteger(entityId) ? botManager.attackEntity(entityId) : { ok: false, message: 'Invalid entity.' }
  )
  handle('bot:setRenderDistance', (_event, blocks) => ({ ok: botManager.setRenderDistance(blocks) }))
  handle('bot:setTrustedPlayers', (_event, names) => {
    botManager.setTrustedPlayers(names)
    return { ok: true }
  })
  handle('bot:followEntity', (_event, entityId) =>
    Number.isInteger(entityId) ? botManager.followEntity(entityId) : { ok: false, message: 'Invalid entity.' }
  )
  on('bot:firstPersonLook', (_event, yaw, pitch) => botManager.firstPerson.look(yaw, pitch))
  handle('bot:firstPersonHit', (_event, entityId) => botManager.firstPerson.hit(entityId))
  handle('bot:firstPersonDig', (_event, position) => botManager.firstPerson.dig(position))
  on('bot:firstPersonStopDig', () => botManager.firstPerson.stopDig())
  handle('bot:firstPersonPlace', (_event, position, face, replace) =>
    botManager.firstPerson.place(position, face, replace === true)
  )

  handle('bot:setMovementControls', (_event, controls) => botManager.manualMovement.setControls(controls))

  // Player skins for the watcher, fetched here since the page can't load other sites' images into WebGL.
  const skinCache = new Map<string, Promise<string | null>>()
  const playerNameCache = new Map<string, Promise<string | null>>()
  handle('bot:getSkin', async (_event, url) => {
    if (typeof url !== 'string' || !/^https:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+$/i.test(url)) {
      return null
    }
    if (!skinCache.has(url)) {
      skinCache.set(
        url,
        fetch(url)
          .then((response) =>
            response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))
          )
          .then((buffer) => `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`)
          .catch((error) => {
            console.error('[Skins] Failed to fetch skin', error)
            skinCache.delete(url)
            return null
          })
      )
    }
    return skinCache.get(url) ?? null
  })

  // A player's name from their UUID, for pet owners who aren't online. Null for offline-mode UUIDs.
  handle('bot:lookupPlayerName', async (_event, uuid) => {
    if (typeof uuid !== 'string' || !/^[0-9a-f]{32}$/.test(uuid)) return null
    if (!playerNameCache.has(uuid)) {
      playerNameCache.set(
        uuid,
        fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`)
          .then((response) =>
            response.ok && response.status !== 204 ? (response.json() as Promise<{ name?: unknown }>) : null
          )
          .then((profile) => (typeof profile?.name === 'string' ? profile.name : null))
          .catch(() => {
            playerNameCache.delete(uuid)
            return null
          })
      )
    }
    return playerNameCache.get(uuid) ?? null
  })

  handle('bot:getPlayerList', () => botManager.getPlayerList())

  handle('bot:getPlayerSkin', (_event, name) =>
    typeof name === 'string' ? botManager.playerSkin(name) : null
  )

  handle('bot:getWorldView', () => {
    return botManager.getWorldView()
  })

  handle('bot:getMaps', (_event, ids) => botManager.getMaps(ids))

  handle('bot:setArmorManagerEnabled', (_event, enabled) => {
    const result = botManager.setArmorManagerEnabled(enabled)
    return { ok: true, enabled: result }
  })

  handle('bot:setAutoEatEnabled', (_event, enabled) => {
    const result = botManager.setAutoEatEnabled(enabled)
    return { ok: true, enabled: result }
  })

  handle('bot:setAutoToolEnabled', (_event, enabled) => {
    const result = botManager.setAutoToolEnabled(enabled)
    return { ok: true, enabled: result }
  })

  handle('bot:setAutoShieldEnabled', (_event, enabled) => {
    const result = botManager.setAutoShieldEnabled(enabled)
    return { ok: true, enabled: result }
  })

  handle('bot:setAutoEatOptions', (_event, options) => {
    const updated = botManager.setAutoEatOptions(options)
    return { ok: true, options: updated }
  })

  handle('bot:setPathfinderOptions', (_event, options) => {
    const updated = botManager.setPathfinderOptions(options)
    return { ok: true, options: updated }
  })

  handle('bot:setPvpOptions', (_event, options) => {
    const updated = botManager.setPvpOptions(options)
    return { ok: true, options: updated }
  })

  on('bot:subscribe', (event) => {
    setActiveWebContents(event.sender)
    const snapshot = botManager.getSnapshot()
    if (snapshot) {
      emitToRenderer('bot:state', snapshot)
    } else {
      emitToRenderer('bot:status', { stage: 'idle', message: 'Bot idle.' })
    }
    const history = botManager.getChatHistory()
    if (history && history.length > 0) {
      emitToRenderer('bot:chatHistory', history)
    }
  })
}
