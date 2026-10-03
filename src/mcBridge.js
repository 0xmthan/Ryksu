const botManager = require('./botManager')

let registered = false

const registerMinecraftIpc = (ipcMain) => {
  if (registered) {
    return
  }
  registered = true

  let activeWebContents = null

  const setActiveWebContents = (webContents) => {
    if (webContents && !webContents.isDestroyed()) {
      activeWebContents = webContents
    }
  }

  const emitToRenderer = (channel, payload) => {
    if (!activeWebContents || activeWebContents.isDestroyed()) {
      return
    }

    activeWebContents.send(channel, payload)
  }

  botManager.on('status', (status) => {
    emitToRenderer('bot:status', status)
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

  botManager.on('pathfinderOptions', (options) => {
    emitToRenderer('bot:pathfinderOptions', options)
  })

  botManager.on('chat', (entry) => {
    emitToRenderer('bot:chat', entry)
  })

  ipcMain.handle('bot:connect', async (event, options) => {
    setActiveWebContents(event.sender)

    try {
      await botManager.connect(options)
      const snapshot = botManager.getSnapshot()
      if (snapshot) {
        emitToRenderer('bot:state', snapshot)
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error?.message || String(error) }
    }
  })

  ipcMain.handle('bot:disconnect', async () => {
    await botManager.disconnect()
    return { ok: true }
  })

  ipcMain.handle('bot:getSnapshot', () => {
    const snapshot = botManager.getSnapshot()
    return snapshot ?? { connected: false }
  })

  ipcMain.handle('bot:getSupportedVersions', () => {
    return botManager.getSupportedVersions()
  })

  ipcMain.handle('bot:getChatHistory', () => {
    return botManager.getChatHistory()
  })

  ipcMain.handle('bot:sendChat', async (_event, message) => {
    try {
      await botManager.sendChat(message)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error?.message || String(error) }
    }
  })

  ipcMain.handle('bot:useBed', async () => {
    try {
      const result = await botManager.useNearestBed()
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, message: error?.message || String(error) }
    }
  })

  ipcMain.handle('bot:pickUpBed', async () => {
    try {
      const result = await botManager.pickUpBed()
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, message: error?.message || String(error) }
    }
  })

  ipcMain.handle('bot:dismissBedPickup', () => {
    botManager.dismissBedPickup()
    return { ok: true }
  })

  ipcMain.handle('bot:startMining', (_event, options) => {
    try {
      return { ok: true, state: botManager.startMining(options) }
    } catch (error) {
      return { ok: false, message: error?.message || String(error) }
    }
  })

  ipcMain.handle('bot:stopMining', () => {
    return { ok: true, state: botManager.stopMining() }
  })

  ipcMain.handle('bot:inventoryAction', async (_event, action) => {
    try {
      await botManager.inventoryAction(action)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error?.message || String(error) }
    }
  })

  ipcMain.handle('bot:attackEntity', (_event, entityId) =>
    Number.isInteger(entityId) ? botManager.attackEntity(entityId) : { ok: false, message: 'Invalid entity.' }
  )

  // Player skins for the watcher, fetched here since the page can't load other sites' images into WebGL.
  const skinCache = new Map()
  ipcMain.handle('bot:getSkin', async (_event, url) => {
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
    return skinCache.get(url)
  })

  ipcMain.handle('bot:getWorldView', () => {
    return botManager.getWorldView()
  })

  ipcMain.handle('bot:setArmorManagerEnabled', (_event, enabled) => {
    const result = botManager.setArmorManagerEnabled(enabled)
    return { ok: true, enabled: result }
  })

  ipcMain.handle('bot:setAutoEatEnabled', (_event, enabled) => {
    const result = botManager.setAutoEatEnabled(enabled)
    return { ok: true, enabled: result }
  })

  ipcMain.handle('bot:setAutoToolEnabled', (_event, enabled) => {
    const result = botManager.setAutoToolEnabled(enabled)
    return { ok: true, enabled: result }
  })

  ipcMain.handle('bot:setAutoShieldEnabled', (_event, enabled) => {
    const result = botManager.setAutoShieldEnabled(enabled)
    return { ok: true, enabled: result }
  })

  ipcMain.handle('bot:setAutoEatOptions', (_event, options) => {
    const updated = botManager.setAutoEatOptions(options)
    return { ok: true, options: updated }
  })

  ipcMain.handle('bot:getAutoEatOptions', () => {
    return botManager.getAutoEatOptions()
  })

  ipcMain.handle('bot:setPathfinderOptions', (_event, options) => {
    const updated = botManager.setPathfinderOptions(options)
    return { ok: true, options: updated }
  })

  ipcMain.handle('bot:getPathfinderOptions', () => {
    return botManager.getPathfinderOptions()
  })

  ipcMain.handle('bot:setPvpOptions', (_event, options) => {
    const updated = botManager.setPvpOptions(options)
    return { ok: true, options: updated }
  })

  ipcMain.handle('bot:getPvpOptions', () => {
    return botManager.getPvpOptions()
  })

  ipcMain.on('bot:subscribe', (event) => {
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

module.exports = { registerMinecraftIpc }
