import type {
  ChatMessage,
  AutoEatOptions,
  BotSnapshot,
  MiningState,
  PathfinderOptions,
  PvpOptions,
  InventoryAction,
  Motion,
  WorldView,
} from './types'

export {}

declare global {
  interface Window {
    electronAPI: {
      minimize: () => void
      close: () => void
      openExternal: (url: string) => Promise<{ ok: boolean; message?: string }>
      bot: {
        connect: (options: {
          host: string
          port?: number | string
          username: string
          accountType: 'offline' | 'online'
          password?: string
          offlinePassword?: string
          preJoinLoginEnabled?: boolean
          version?: string
          armorManagerEnabled?: boolean
          autoEatEnabled?: boolean
          autoToolEnabled?: boolean
          autoShieldEnabled?: boolean
          autoEatOptions?: Partial<AutoEatOptions>
          pathfinder?: Partial<PathfinderOptions>
          pvp?: Partial<PvpOptions>
        }) => Promise<{ ok: boolean; message?: string }>
        disconnect: () => Promise<{ ok: boolean }>
        getSnapshot: () => Promise<BotSnapshot>
        getSupportedVersions: () => Promise<string[]>
        subscribe: () => void
        onStatus: (
          callback: (status: {
            stage: string
            message?: string
            microsoftAuth?: {
              verificationUri: string
              directVerificationUri?: string
              userCode: string
            }
          }) => void
        ) => () => void
        onState: (callback: (state: BotSnapshot) => void) => () => void
        onChat: (callback: (entry: ChatMessage) => void) => () => void
        onPathfinderOptions: (callback: (options: PathfinderOptions) => void) => () => void
        onChatHistory: (callback: (entries: ChatMessage[]) => void) => () => void
        getChatHistory: () => Promise<ChatMessage[]>
        sendChat: (message: string) => Promise<{ ok: boolean; message?: string }>
        useBed: () => Promise<{ ok: boolean; sleeping?: boolean; message?: string }>
        pickUpBed: () => Promise<{ ok: boolean; message?: string }>
        dismissBedPickup: () => Promise<{ ok: boolean }>
        startMining: (options: { ores: string[] }) => Promise<{
          ok: boolean
          state?: MiningState
          message?: string
        }>
        stopMining: () => Promise<{ ok: boolean; state: MiningState }>
        getWorldView: () => Promise<WorldView | null>
        // A player skin as a data URL, or null if it couldn't be fetched.
        getSkin: (url: string) => Promise<string | null>
        // Chase and attack an entity by id until it dies or gets away.
        attackEntity: (entityId: number) => Promise<{ ok: boolean; message?: string }>
        onWorld: (callback: (view: WorldView) => void) => () => void
        inventoryAction: (action: InventoryAction) => Promise<{ ok: boolean; message?: string }>
        onMotion: (callback: (motion: Motion) => void) => () => void
        setArmorManagerEnabled: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>
        setAutoEatEnabled: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>
        setAutoToolEnabled: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>
        setAutoShieldEnabled: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>
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
