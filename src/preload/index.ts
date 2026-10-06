import { contextBridge, ipcRenderer } from 'electron'
import { createElectronAPI } from './electronApi'

contextBridge.exposeInMainWorld('electronAPI', createElectronAPI(ipcRenderer))
