import './silenceKnownWarnings'
import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { checkForUpdates, RELEASES_URL } from './appUpdates'
import type { AppInfo } from './ipc'
import { registerMinecraftIpc } from './mcBridge'

// Set by Electron Forge's Vite plugin.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

// An unlimited frame rate needs Chromium's frame cap (vsync) off, which only works from launch. The choice is
// kept here, since the page's storage can't be read before the window opens.
const displaySettingsPath = path.join(app.getPath('userData'), 'display.json')
const unlimitedFpsAtLaunch = (() => {
  try {
    return JSON.parse(fs.readFileSync(displaySettingsPath, 'utf8')).unlimitedFps === true
  } catch {
    return false
  }
})()
if (unlimitedFpsAtLaunch) {
  app.commandLine.appendSwitch('disable-frame-rate-limit')
  app.commandLine.appendSwitch('disable-gpu-vsync')
}

ipcMain.handle('app:getUnlimitedFps', () => unlimitedFpsAtLaunch)
ipcMain.handle('app:setUnlimitedFps', (_event, enabled: unknown) => {
  try {
    fs.writeFileSync(displaySettingsPath, JSON.stringify({ unlimitedFps: enabled === true }))
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

registerMinecraftIpc(ipcMain)

const getAppInfo = (): AppInfo => ({
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
  clipboard.writeText(
    [
      `Ryksu ${info.version}`,
      `Platform: ${info.platform} / ${info.arch}`,
      `Electron: ${info.electron}`,
      `Chromium: ${info.chromium}`,
      `Node.js: ${info.node}`,
    ].join('\n')
  )
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
