// The channels between the window and the main process, in one place: the preload (src/preload.ts) calls
// them and the main process (src/main.ts, src/mcBridge.ts) answers, both typed from these maps.
import type { UpdateCheck } from './appUpdates'
import type {
  AutoEatOptions,
  BotSnapshot,
  BotStatusPayload,
  BreakingState,
  BuildAction,
  BuildCells,
  ChatMessage,
  InventoryAction,
  MiningState,
  Motion,
  MovementControls,
  PathfinderOptions,
  PlayerList,
  PvpOptions,
  ServerPing,
  TradeOffer,
  WorldView,
} from './types'

export type Vec3Like = { x: number; y: number; z: number }

// Most actions answer with whether they worked and, if not, why.
export type Result<T = unknown> = { ok: boolean; message?: string } & T

export type AppInfo = {
  version: string
  electron: string
  chromium: string
  node: string
  platform: string
  arch: string
}

export type ConnectOptions = {
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
  trustedPlayers?: string[]
  pvp?: Partial<PvpOptions>
}

// The bot's own position and velocity (blocks per tick), every physics tick.
export type SelfMotion = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  onGround: boolean
  sprinting?: boolean
}

// Request/response channels (ipcRenderer.invoke / ipcMain.handle): arguments and what comes back.
export type InvokeChannels = {
  'app:getInfo': { args: []; result: AppInfo }
  'app:copyInfo': { args: []; result: { ok: boolean } }
  'app:checkForUpdates': { args: []; result: UpdateCheck }
  // Whether this launch has Chromium's frame cap off (see main.ts), and the choice for the next launch.
  'app:getUnlimitedFps': { args: []; result: boolean }
  'app:setUnlimitedFps': { args: [enabled: boolean]; result: { ok: boolean } }
  'system:openExternal': { args: [url: string]; result: Result }
  // Pointer lock for first person, granted as a user gesture (see main.ts).
  'window:grabPointer': { args: []; result: void }
  // The server's status from the multiplayer-list ping, without joining.
  'server:ping': { args: [target: { host: string; port: string }]; result: ServerPing }
  'bot:connect': { args: [options: ConnectOptions]; result: Result }
  'bot:disconnect': { args: []; result: { ok: boolean } }
  'bot:getSnapshot': { args: []; result: BotSnapshot }
  'bot:getSupportedVersions': { args: []; result: string[] }
  'bot:getChatHistory': { args: []; result: ChatMessage[] }
  'bot:sendChat': { args: [message: string]; result: Result }
  'bot:useBed': { args: []; result: Result<{ sleeping?: boolean }> }
  'bot:pickUpBed': { args: []; result: Result }
  'bot:dismissBedPickup': { args: []; result: { ok: boolean } }
  'bot:startMining': {
    args: [options: { ores: string[]; blocks: string[] }]
    result: Result<{ state?: MiningState }>
  }
  'bot:stopMining': { args: []; result: { ok: boolean; state: MiningState } }
  // Every block the connected bot's version can break, sorted by display name.
  'bot:getMineableBlocks': { args: []; result: { name: string; displayName: string }[] }
  // Adds the chest at the position to Auto Mine's deposit list, or removes it if it's already there.
  'bot:toggleMiningChest': {
    args: [position: Vec3Like]
    result: Result<{ added?: boolean; state?: MiningState }>
  }
  'bot:clearMiningChests': { args: []; result: { ok: boolean; state: MiningState } }
  'bot:getWorldView': { args: []; result: WorldView | null }
  // A player skin as a data URL, or null if it couldn't be fetched.
  'bot:getSkin': { args: [url: string]; result: string | null }
  // A player's name from their UUID (dashless), or null if Mojang doesn't know it.
  'bot:lookupPlayerName': { args: [uuid: string]; result: string | null }
  // The skin texture URL of a player on the server, or null (offline mode has none).
  'bot:getPlayerSkin': { args: [name: string]; result: string | null }
  // Who's on the server now, and remembered players who aren't.
  'bot:getPlayerList': { args: []; result: PlayerList }
  // Chase and attack an entity by id until it dies or gets away.
  'bot:attackEntity': { args: [entityId: number]; result: Result }
  'bot:followEntity': { args: [entityId: number]; result: Result }
  // Who may command the bot with gestures; saved by the renderer (see utils/trustedPlayers.ts).
  'bot:setTrustedPlayers': { args: [names: string[]]; result: { ok: boolean } }
  // Blocks out from the bot the 3D view covers (16-120).
  'bot:setRenderDistance': { args: [blocks: number]; result: { ok: boolean } }
  // The watcher's first person view (see src/bot/plugins/firstPersonActions.ts).
  'bot:firstPersonHit': { args: [entityId: number | null]; result: { ok: boolean } }
  'bot:firstPersonDig': { args: [position: Vec3Like]; result: Result }
  // `replace`: the clicked block is grass or the like, which the placed block takes the place of.
  'bot:firstPersonPlace': { args: [position: Vec3Like, face: Vec3Like, replace?: boolean]; result: Result }
  'bot:setMovementControls': { args: [controls: MovementControls]; result: Result }
  // Walk up to a door and open it.
  'bot:openDoor': { args: [location: Vec3Like, standLocation?: Vec3Like]; result: Result }
  'bot:interactBlock': { args: [position: Vec3Like]; result: Result }
  'bot:inventoryAction': { args: [action: InventoryAction]; result: Result }
  // Build mode: break or place a line of blocks.
  'bot:buildAction': { args: [action: BuildAction]; result: Result }
  // Stop a build line after the block in progress.
  'bot:cancelBuild': { args: []; result: { ok: boolean; stopped: boolean } }
  // Walk to a villager or wandering trader and open its trades.
  'bot:openTrader': { args: [entityId: number]; result: Result<{ trades?: TradeOffer[] }> }
  // Make one trade from the open trader `count` times.
  'bot:trade': { args: [index: number, count: number]; result: Result<{ trades?: TradeOffer[] }> }
  'bot:closeTrader': { args: []; result: { ok: boolean } }
  'bot:setArmorManagerEnabled': { args: [enabled: boolean]; result: { ok: boolean; enabled: boolean } }
  'bot:setAutoEatEnabled': { args: [enabled: boolean]; result: { ok: boolean; enabled: boolean } }
  'bot:setAutoToolEnabled': { args: [enabled: boolean]; result: { ok: boolean; enabled: boolean } }
  'bot:setAutoShieldEnabled': { args: [enabled: boolean]; result: { ok: boolean; enabled: boolean } }
  'bot:setAutoEatOptions': {
    args: [options: Partial<AutoEatOptions>]
    result: { ok: boolean; options: AutoEatOptions }
  }
  'bot:getAutoEatOptions': { args: []; result: AutoEatOptions }
  'bot:setPathfinderOptions': {
    args: [options: Partial<PathfinderOptions>]
    result: { ok: boolean; options: PathfinderOptions }
  }
  'bot:getPathfinderOptions': { args: []; result: PathfinderOptions }
  'bot:setPvpOptions': { args: [options: Partial<PvpOptions>]; result: { ok: boolean; options: PvpOptions } }
  'bot:getPvpOptions': { args: []; result: PvpOptions }
}

// Fire-and-forget channels (ipcRenderer.send / ipcMain.on) and their arguments.
export type SendChannels = {
  'window-controls': [action: 'minimize' | 'close']
  'bot:subscribe': []
  'bot:firstPersonLook': [yaw: number, pitch: number]
  'bot:firstPersonStopDig': []
}

// Main process → window pushes (webContents.send) and their payloads.
export type EventChannels = {
  'bot:status': BotStatusPayload
  'bot:state': BotSnapshot
  'bot:chat': ChatMessage
  'bot:chatHistory': ChatMessage[]
  'bot:pathfinderOptions': PathfinderOptions
  // Short results of actions (a door opened, …).
  'bot:notice': string
  // Blocks still to break or place in build mode.
  'bot:buildCells': BuildCells
  // Blocks cracking (destroy stage 0-9) and a block the bot just broke (see src/bot/breakProgress.ts).
  'bot:breaking': BreakingState
  'bot:world': WorldView
  'bot:motion': Motion
  'bot:selfMotion': SelfMotion
}

export type InvokeChannel = keyof InvokeChannels
export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['args']
export type InvokeResult<C extends InvokeChannel> = InvokeChannels[C]['result']
