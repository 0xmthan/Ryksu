import { contextBridge, ipcRenderer } from 'electron'
import { createAppStore } from './appStore'
import { createElectronAPI } from './electronApi'

contextBridge.exposeInMainWorld('electronAPI', createElectronAPI(ipcRenderer))
contextBridge.exposeInMainWorld('ryksuStore', createAppStore(ipcRenderer, globalThis.localStorage ?? null))
