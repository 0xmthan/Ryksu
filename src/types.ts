export type AccountType = 'offline' | 'online'

export type BotStatusPayload = {
  stage: string
  message?: string
  microsoftAuth?: {
    verificationUri: string
    directVerificationUri?: string
    userCode: string
  }
}

export type BotStatus = BotStatusPayload | null

export type BotSnapshot =
  | {
      connected: true
      isSleeping?: boolean
      canSleep?: boolean
      bedPickupPending?: boolean
      mining?: MiningState
      health: number
      food: number
      saturation: number
      position: { x: number; y: number; z: number } | null
      xp: {
        level: number
        points: number
        progress: number
      }
      ping: number | null
    }
  | { connected: false }

export type LastConnection = {
  host: string
  port: string
  username: string
  accountType: AccountType
  version?: string
  offlinePassword?: string
  preJoinLoginEnabled?: boolean
}

export type ChatMessage = {
  id: string
  text: string
  author: string
  type: 'chat' | 'system'
  position: string | null
  timestamp: number
}

export type StoredTranscriptMeta = {
  key: string
  label: string
  messages: ChatMessage[]
}

export type AutoEatPriority = 'foodPoints' | 'saturation' | 'effectiveQuality' | 'saturationRatio'

export type AutoEatOptions = {
  priority: AutoEatPriority
  minHunger: number
  minHealth: number
  returnToLastItem: boolean
  offhand: boolean
  eatingTimeout: number
  bannedFood: string[]
  strictErrors: boolean
}

export type PathfinderOptions = {
  followEnabled: boolean
  followTarget: string
  goToLocation?: {
    x: number
    y: number
    z: number
  }
  cancelGoTo?: boolean
}

export type PvpOptions = {
  mobEnabled: boolean
  playerEnabled: boolean
  playerTarget: string
  mobMovementEnabled: boolean
  allowBlockBreak: boolean
  jumpAttackEnabled: boolean
}

export type MiningState = {
  active: boolean
  ores: string[]
  chest: { x: number; y: number; z: number } | null
  mined: number
  deposited: number
  status: string
}

export type InventoryItem = {
  name: string
  displayName: string
  count: number
} | null

export type WorldView = {
  inventory: {
    main: InventoryItem[]
    hotbar: InventoryItem[]
    armor: { head: InventoryItem; torso: InventoryItem; legs: InventoryItem; feet: InventoryItem }
    offhand: InventoryItem
    selectedHotbar: number
    freeSlots: number
  }
  blocks: {
    // Changes whenever any block in the view changes.
    key: string
    origin: { x: number; y: number; z: number }
    radius: number
    palette: string[]
    // Block positions relative to origin as flat [x, y, z, x, y, z, …], one palette index per block.
    positions: number[]
    blocks: number[]
  }
}

export type InventoryAction =
  | { type: 'move'; from: number; to: number }
  | { type: 'drop'; slot: number; all: boolean }
  | { type: 'hold'; slot: number }

export type EntityKind = 'player' | 'hostile' | 'passive' | 'item'

export type Motion = {
  bot: { x: number; y: number; z: number; yaw: number }
  entities: { id: number; kind: EntityKind; name: string; x: number; y: number; z: number; yaw: number }[]
}
