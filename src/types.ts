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
    door?: {
      x: number
      y: number
      z: number
    }
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

export type InventoryWindow = {
  id: number
  type: string
  title: string
  slots: InventoryItem[]
  inventoryStart: number
  resultSlot: number
}

export type WorldView = {
  inventory: {
    window: InventoryWindow | null
    crafting: InventoryItem[]
    craftingResult: InventoryItem
    cursor: InventoryItem
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
    // Block state properties for each palette entry (facing, axis, half, …).
    properties: Record<string, string | number | boolean>[]
    // Block positions relative to origin as flat [x, y, z, x, y, z, …], one palette index per block.
    positions: number[]
    blocks: number[]
    // Per block: bits 0-5 = visible faces (up, down, north, south, west, east), 6-8 = view mode hints
    // (see src/utils/viewMode.ts).
    faces: number[]
    roofCutoff: number
    // Where the bot is, for picking the view mode automatically.
    environment: 'outside' | 'indoors' | 'cave'
  }
}

export type InventoryClick = { slot: number; button: number; mode: 0 | 1 | 2 | 4 }

export type InventoryAction =
  | { type: 'click'; clicks: InventoryClick[]; windowId?: number }
  | { type: 'close'; windowId?: number }
  | { type: 'rename'; name: string; windowId: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'drop'; slot: number; all: boolean }
  | { type: 'hold'; slot: number }

export type EntityKind = 'player' | 'hostile' | 'passive' | 'item'

export type MovementControls = {
  sprint: boolean
  sneak: boolean
  jump: boolean
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  yaw: number
}

export type EquipmentSlot = 'mainhand' | 'offhand' | 'head' | 'chest' | 'legs' | 'feet'

// A held or worn item; leather armor carries its dye.
export type WornItem = { name: string; color?: string }

// Where something is and how it's posed. swing and hurt count up with each arm swing and hit.
export type EntityPose = {
  x: number
  y: number
  z: number
  yaw: number
  headYaw: number
  pitch: number
  swing: number
  hurt: number
  dead?: boolean
  // Sneaking (players), and sitting on command (cats, wolves, parrots).
  crouching?: boolean
  sitting?: boolean
  equipment?: Partial<Record<EquipmentSlot, WornItem>>
}

export type MotionEntity = EntityPose & {
  health?: number
  ping?: number
  id: number
  kind: EntityKind
  type: string | null
  item: string | null
  name: string
  baby?: boolean
  // Texture variant (cat breed, horse color, …) and horse coat markings.
  variant?: string
  markings?: string
  // Sheep wool color; null when sheared.
  wool?: string | null
  // Registry ids of the villager's biome type and profession.
  villager?: { type: number; profession: number }
  // Mojang skin URL for players.
  cape?: string
  skin?: string
  // The skin is made for slim (3-pixel) arms.
  slim?: boolean
}

export type Motion = {
  // World time of day in ticks (0 sunrise, 6000 noon, 12000 sunset, 18000 midnight).
  time: number
  bot: EntityPose & { name?: string; health?: number; skin: string | null; cape?: string | null; slim: boolean }
  entities: MotionEntity[]
}
