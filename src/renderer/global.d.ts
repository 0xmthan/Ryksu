import type { ElectronAPI } from '../preload/electronApi'

export {}

declare global {
  interface Window {
    // Exposed by the preload (built in src/preload/electronApi.ts); its channels are typed in src/ipc.ts.
    electronAPI: ElectronAPI
  }
}
