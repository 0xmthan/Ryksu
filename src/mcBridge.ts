import { Notification, type IpcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import botManager from './botManager'
import type { EventChannels, InvokeArgs, InvokeChannel, InvokeResult, SendChannels } from './ipc'
import { pingServer } from './serverPing'

let registered = false

const errorMessage = (error: unknown) => (error as Error | undefined)?.message || String(error)

export const registerMinecraftIpc = (ipcMain: IpcMain) => {
  if (registered) {
    return
  }
  registered = true

  // Arguments come from the window as typed in src/ipc.ts, but handlers still check the ones they act on.
  const handle = <C extends InvokeChannel>(
    channel: C,
    handler: (
      event: IpcMainInvokeEvent,
      ...args: InvokeArgs<C>
    ) => InvokeResult<C> | Promise<InvokeResult<C>>
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

  handle('bot:connect', async (event, options) => {
    setActiveWebContents(event.sender)

    try {
      await botManager.connect(options)
      const snapshot = botManager.getSnapshot()
      if (snapshot) {
        emitToRenderer('bot:state', snapshot)
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle('bot:disconnect', async () => {
    await botManager.disconnect()
    return { ok: true }
  })

  handle('bot:getSnapshot', () => {
    const snapshot = botManager.getSnapshot()
    return snapshot ?? { connected: false }
  })

  handle('bot:getSupportedVersions', () => {
    return botManager.getSupportedVersions()
  })

  handle('bot:getChatHistory', () => {
    return botManager.getChatHistory()
  })

  handle('bot:sendChat', async (_event, message) => {
    try {
      await botManager.sendChat(message)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle('bot:useBed', async () => {
    try {
      const result = await botManager.useNearestBed()
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle('bot:pickUpBed', async () => {
    try {
      const result = await botManager.pickUpBed()
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle('bot:dismissBedPickup', () => {
    botManager.dismissBedPickup()
    return { ok: true }
  })

  handle('bot:startMining', (_event, options) => {
    try {
      return { ok: true, state: botManager.startMining(options) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle('bot:toggleMiningChest', (_event, position) => {
    try {
      return { ok: true, ...botManager.toggleMiningChest(position) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle('bot:clearMiningChests', () => ({ ok: true, state: botManager.clearMiningChests() }))

  handle('bot:getMineableBlocks', () => botManager.getMineableBlocks())

  handle('bot:stopMining', () => {
    return { ok: true, state: botManager.stopMining() }
  })

  handle('bot:interactBlock', async (_event, position) => {
    try {
      await botManager.interactBlock(position)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle('bot:inventoryAction', async (_event, action) => {
    try {
      await botManager.inventoryAction(action)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle('bot:buildAction', async (_event, action) => {
    try {
      return { ok: true, message: await botManager.buildAction(action) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle('bot:cancelBuild', () => ({ ok: true, stopped: botManager.cancelBuild() }))

  handle('bot:openTrader', async (_event, entityId) => {
    if (!Number.isInteger(entityId)) return { ok: false, message: 'Invalid entity.' }
    try {
      return { ok: true, trades: await botManager.openTrader(entityId) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle('bot:trade', async (_event, index, count) => {
    if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1) {
      return { ok: false, message: 'Invalid trade.' }
    }
    try {
      return { ok: true, trades: await botManager.trade(index, count) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
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

  handle('bot:openDoor', (_event, location, standLocation) => {
    if (!location || !Number.isFinite(location.x) || !Number.isFinite(location.y) || !Number.isFinite(location.z)) {
      return { ok: false, message: 'Invalid location.' }
    }
    botManager.openDoor(location, standLocation)
    return { ok: true }
  })

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
          .then((response) => (response.ok && response.status !== 204 ? response.json() : null))
          .then((profile: { name?: unknown } | null) => (typeof profile?.name === 'string' ? profile.name : null))
          .catch(() => {
            playerNameCache.delete(uuid)
            return null
          })
      )
    }
    return playerNameCache.get(uuid) ?? null
  })

  handle('bot:getPlayerList', () => botManager.getPlayerList())

  handle('bot:getPlayerSkin', (_event, name) => (typeof name === 'string' ? botManager.playerSkin(name) : null))

  handle('bot:getWorldView', () => {
    return botManager.getWorldView()
  })

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

  handle('bot:getAutoEatOptions', () => {
    return botManager.getAutoEatOptions()
  })

  handle('bot:setPathfinderOptions', (_event, options) => {
    const updated = botManager.setPathfinderOptions(options)
    return { ok: true, options: updated }
  })

  handle('bot:getPathfinderOptions', () => {
    return botManager.getPathfinderOptions()
  })

  handle('bot:setPvpOptions', (_event, options) => {
    const updated = botManager.setPvpOptions(options)
    return { ok: true, options: updated }
  })

  handle('bot:getPvpOptions', () => {
    return botManager.getPvpOptions()
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
