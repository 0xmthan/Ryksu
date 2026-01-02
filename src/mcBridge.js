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
