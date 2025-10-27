const { app, BrowserWindow, ipcMain } = require('electron')
const { registerMinecraftIpc } = require('./mcBridge')

if (require('electron-squirrel-startup')) {
  app.quit()
}

registerMinecraftIpc(ipcMain)

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

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 750,
    height: 500,
    resizable: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
    },
  })

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(false)
  }
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY)
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
