import type { ChatMessage, AutoEatOptions, PathfinderOptions, PvpOptions } from './types'

export {}

declare global {
  interface Window {
    electronAPI: {
      minimize: () => void
      close: () => void
      bot: {
        connect: (options: {
          host: string
          port?: number | string
          username: string
          accountType: 'offline' | 'online'
          password?: string
          offlinePassword?: string
          version?: string
          armorManagerEnabled?: boolean
          autoEatEnabled?: boolean
          autoEatOptions?: Partial<AutoEatOptions>
          pathfinder?: Partial<PathfinderOptions>
          pvp?: Partial<PvpOptions>
        }) => Promise<{ ok: boolean; message?: string }>
        disconnect: () => Promise<{ ok: boolean }>
        getSnapshot: () => Promise<
          | {
              connected: true
              health: number
              food: number
              saturation: number
              position: { x: number; y: number; z: number } | null
              xp: { level: number; points: number; progress: number }
              ping: number | null
            }
          | { connected: false }
        >
        getSupportedVersions: () => Promise<string[]>
        subscribe: () => void
        onStatus: (callback: (status: { stage: string; message?: string }) => void) => () => void
        onState: (
          callback: (
            state:
              | {
                  connected: true
                  health: number
                  food: number
                  saturation: number
                  position: { x: number; y: number; z: number } | null
                  xp: { level: number; points: number; progress: number }
                  ping: number | null
                }
              | { connected: false }
          ) => void
        ) => () => void
        onChat: (callback: (entry: ChatMessage) => void) => () => void
        onChatHistory: (callback: (entries: ChatMessage[]) => void) => () => void
        getChatHistory: () => Promise<ChatMessage[]>
        sendChat: (message: string) => Promise<{ ok: boolean; message?: string }>
        setArmorManagerEnabled: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>
        setAutoEatEnabled: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>
        setAutoEatOptions: (options: Partial<AutoEatOptions>) => Promise<{
          ok: boolean
          options: AutoEatOptions
        }>
        getAutoEatOptions: () => Promise<AutoEatOptions>
        setPathfinderOptions: (options: Partial<PathfinderOptions>) => Promise<{
          ok: boolean
          options: PathfinderOptions
        }>
        getPathfinderOptions: () => Promise<PathfinderOptions>
        setPvpOptions: (options: Partial<PvpOptions>) => Promise<{
          ok: boolean
          options: PvpOptions
        }>
        getPvpOptions: () => Promise<PvpOptions>
      }
    }
  }
}
