import type { ElectronAPI } from './electronApi'

export {}

declare global {
  interface Window {
    // Exposed by the preload (built in src/electronApi.ts); its channels are typed in src/ipc.ts.
    electronAPI: ElectronAPI
  }
}
