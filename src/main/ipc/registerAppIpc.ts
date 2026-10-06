import type { Clipboard, IpcMain, Shell } from 'electron'
import { checkForUpdates as checkReleases, RELEASES_URL } from '../services/updates'
import type { AppInfo, UpdateCheck } from '../../shared/ipc'

type AppIpcOptions = {
  ipcMain: Pick<IpcMain, 'handle'>
  clipboard: Pick<Clipboard, 'writeText'>
  shell: Pick<Shell, 'openExternal'>
  getAppInfo: () => AppInfo
  checkForUpdates?: (currentVersion: string) => Promise<UpdateCheck>
}

// The app's own channels: its version and system details, and checking for a newer release.
export const registerAppIpc = ({
  ipcMain,
  clipboard,
  shell,
  getAppInfo,
  checkForUpdates = checkReleases,
}: AppIpcOptions) => {
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

  ipcMain.handle('app:checkForUpdates', async (): Promise<UpdateCheck> => {
    const result = await checkForUpdates(getAppInfo().version)
    if (result.status === 'available') {
      try {
        await shell.openExternal(RELEASES_URL)
      } catch {
        return { status: 'error', message: 'An update is available, but the releases page could not open.' }
      }
    }
    return result
  })
}
