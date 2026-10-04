import type {
  ChatMessage,
  AutoEatOptions,
  BotSnapshot,
  MiningState,
  PathfinderOptions,
  PvpOptions,
  InventoryAction,
  TradeOffer,
  BuildAction,
  BuildCells,
  PlayerList,
  Motion,
  MovementControls,
  WorldView,
} from './types'

export {}

declare global {
  interface Window {
    electronAPI: {
      copyAppInfo: () => Promise<{ ok: boolean }>
      checkForUpdates: () => Promise<{
        status: 'available' | 'current' | 'no-release' | 'error'
        version?: string
        message?: string
      }>
      getAppInfo: () => Promise<{
        version: string
        electron: string
        chromium: string
        node: string
        platform: string
        arch: string
      }>
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
        // Short results of actions (a door opened, …).
        onNotice: (callback: (text: string) => void) => () => void
        // Blocks still to break or place in build mode.
        onBuildCells: (callback: (cells: BuildCells) => void) => () => void
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
        // A player's name from their UUID (dashless), or null if Mojang doesn't know it.
        lookupPlayerName: (uuid: string) => Promise<string | null>
        // The skin texture URL of a player on the server, or null (offline mode has none).
        getPlayerSkin: (name: string) => Promise<string | null>
        // Who's on the server now, and remembered players who aren't.
        getPlayerList: () => Promise<PlayerList>
        // Chase and attack an entity by id until it dies or gets away.
        attackEntity: (entityId: number) => Promise<{ ok: boolean; message?: string }>
        followEntity: (entityId: number) => Promise<{ ok: boolean; message?: string }>
        setMovementControls: (controls: MovementControls) => Promise<{ ok: boolean; message?: string }>
        // Walk up to a door and open it.
        openDoor: (
          location: { x: number; y: number; z: number },
          standLocation?: { x: number; y: number; z: number }
        ) => Promise<{ ok: boolean; message?: string }>
        onWorld: (callback: (view: WorldView) => void) => () => void
        interactBlock: (position: { x: number; y: number; z: number }) => Promise<{ ok: boolean; message?: string }>
        inventoryAction: (action: InventoryAction) => Promise<{ ok: boolean; message?: string }>
        // Build mode: break or place a line of blocks.
        buildAction: (action: BuildAction) => Promise<{ ok: boolean; message?: string }>
        // Stop a build line after the block in progress.
        cancelBuild: () => Promise<{ ok: boolean; stopped: boolean }>
        // Walk to a villager or wandering trader and open its trades.
        openTrader: (entityId: number) => Promise<{ ok: boolean; message?: string; trades?: TradeOffer[] }>
        // Make one trade from the open trader `count` times.
        trade: (index: number, count: number) => Promise<{ ok: boolean; message?: string; trades?: TradeOffer[] }>
        closeTrader: () => Promise<{ ok: boolean }>
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
