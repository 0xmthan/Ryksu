import './silenceKnownWarnings'
import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import path from 'node:path'
import { registerAppIpc } from './ipc/registerAppIpc'
import { BotManager } from './bot/botManager'
import { registerBotIpc } from './ipc/registerBotIpc'
import { createControlApi } from './controlApi'
import { loadWindowStore, readSettings, setWindowValue, updateSettings } from './storage/appStore'
import { importWindowStorage, migrateDataFolder } from './storage/migrate'

// Set by Electron Forge's Vite plugin.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

// Saves live in ~/.ryksu (see storage/ryksuHome.ts); older versions kept them in the data folder.
migrateDataFolder(app.getPath('userData'))

// An unlimited frame rate needs Chromium's frame cap (vsync) off, which only works from launch.
const unlimitedFpsAtLaunch = readSettings().unlimitedFps === true
if (unlimitedFpsAtLaunch) {
  app.commandLine.appendSwitch('disable-frame-rate-limit')
  app.commandLine.appendSwitch('disable-gpu-vsync')
}

ipcMain.handle('app:getUnlimitedFps', () => unlimitedFpsAtLaunch)
ipcMain.handle('app:setUnlimitedFps', (_event, enabled: unknown) => {
  try {
    updateSettings((settings) => {
      settings.unlimitedFps = enabled === true
    })
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

// The window's saves: all of them at once, synchronously, when its preload starts (it reads them like
// localStorage), then each change as it happens.
ipcMain.on('store:load', (event) => {
  try {
    event.returnValue = loadWindowStore()
  } catch (error) {
    console.error('[Store] Could not load the saves', error)
    event.returnValue = {}
  }
})
ipcMain.on('store:set', (_event, key: unknown, value: unknown) => {
  if (typeof key !== 'string' || (value !== null && typeof value !== 'string')) return
  try {
    setWindowValue(key, value)
  } catch (error) {
    console.error(`[Store] Could not save ${key}`, error)
  }
})
// The window's old localStorage saves, moved over once; answers with the keys taken.
ipcMain.on('store:import', (event, entries: unknown) => {
  try {
    event.returnValue = importWindowStorage((entries ?? {}) as Record<string, string>)
  } catch (error) {
    console.error('[Store] Could not move the old saves', error)
    event.returnValue = []
  }
})

const botManager = new BotManager()
registerBotIpc(ipcMain, botManager)

// The control API (Settings → Developer): off unless turned on, and remembered across launches.
const controlApi = createControlApi(botManager, () => BrowserWindow.getAllWindows()[0] ?? null)
if (readSettings().controlApi?.enabled === true) void controlApi.start()

ipcMain.handle('app:getControlApi', () => controlApi.status())
ipcMain.handle('app:setControlApi', async (_event, enabled: unknown) => {
  const wanted = enabled === true
  try {
    updateSettings((settings) => {
      settings.controlApi = { enabled: wanted }
    })
  } catch (error) {
    console.error('[Control] Could not save the setting', error)
  }
  return wanted ? controlApi.start() : controlApi.stop()
})

registerAppIpc({
  ipcMain,
  clipboard,
  shell,
  getAppInfo: () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }),
})

ipcMain.on('window-controls', (event, action: unknown) => {
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

// Grabs the mouse for the watcher's first person view as if the user had clicked: the page can't after Esc
// (closing chat), which doesn't count as a user gesture.
ipcMain.handle('window:grabPointer', (event) =>
  event.sender.executeJavaScript('window.__ryksuGrabPointer?.()', true).catch(() => {})
)

ipcMain.handle('system:openExternal', async (_event, url: unknown) => {
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

  mainWindow.setWindowButtonVisibility(false)
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})
