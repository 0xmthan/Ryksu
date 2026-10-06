import type { ElectronAPI } from './preload'

export {}

declare global {
  interface Window {
    // Exposed by the preload; its channels are typed in src/ipc.ts.
    electronAPI: ElectronAPI
  }
}
