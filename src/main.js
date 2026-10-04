// node-rsa (used by minecraft-protocol) still calls `new Buffer()`. Node hides that warning for code in
// node_modules, but bundlers may inline it into our own file, so drop just that one. Must run before requiring it.
const originalEmitWarning = process.emitWarning
process.emitWarning = (warning, ...args) => {
  const code = typeof args[0] === 'object' ? args[0]?.code : args[1]
  if (code === 'DEP0005') {
    return
  }
  return originalEmitWarning.call(process, warning, ...args)
}

const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron')
const path = require('node:path')
const { registerMinecraftIpc } = require('./mcBridge')
const { checkForUpdates, RELEASES_URL } = require('./appUpdates')

if (require('electron-squirrel-startup')) {
  app.quit()
}

const originalConsoleLog = console.log.bind(console)

console.log = (...args) => {
  const firstArg = typeof args[0] === 'string' ? args[0] : ''
  if (firstArg.startsWith('Chunk size is ') && firstArg.includes('partial packet')) {
    originalConsoleLog('[Protocol] Server/plugin compatibility issue while parsing a packet.')
    return
  }

  originalConsoleLog(...args)
}

registerMinecraftIpc(ipcMain)

const getAppInfo = () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
})

ipcMain.handle('app:getInfo', getAppInfo)

ipcMain.handle('app:copyInfo', () => {
  const info = getAppInfo()
  clipboard.writeText([
    `Ryksu ${info.version}`,
    `Platform: ${info.platform} / ${info.arch}`,
    `Electron: ${info.electron}`,
    `Chromium: ${info.chromium}`,
    `Node.js: ${info.node}`,
  ].join('\n'))
  return { ok: true }
})

ipcMain.handle('app:checkForUpdates', async () => {
  const result = await checkForUpdates(app.getVersion())
  if (result.status === 'available') {
    try {
      await shell.openExternal(RELEASES_URL)
    } catch {
      return { status: 'error', message: 'An update is available, but the releases page could not open.' }
    }
  }
  return result
})

ipcMain.on('window-controls', (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender)

  if (!window) {
    return
  }

  switch (action) {
    case 'minimize': {
      window.minimize()
      break
    }
    case 'close': {
      window.close()
      break
    }
    default:
      break
  }
})

ipcMain.handle('system:openExternal', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { ok: false, message: 'Invalid URL.' }
  }

  await shell.openExternal(url)
  return { ok: true }
})

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1125,
    height: 750,
    resizable: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  })

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(false)
  }
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  }
  //mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
