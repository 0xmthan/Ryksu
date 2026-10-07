import type { Automation } from './scriptApi'

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

// A server list ping result. `motd` keeps its § formatting codes.
export type ServerPing =
  | {
      ok: true
      motd: string
      favicon: string | null
      version: string | null
      players: { online: number; max: number; sample: string[] } | null
      latency: number | null
    }
  | { ok: false; message: string }

export type BotSnapshot =
  | {
      connected: true
      isSleeping?: boolean
      canSleep?: boolean
      bedPickupPending?: boolean
      mining?: MiningState
      // What the bot is eating right now (auto eat).
      eating?: string
      effects?: StatusEffect[]
      health: number
      food: number
      saturation: number
      // Air, 0-20 like health; shown while `underwater` or still refilling.
      oxygen: number
      underwater: boolean
      position: { x: number; y: number; z: number } | null
      xp: {
        level: number
        points: number
        progress: number
      }
      ping: number | null
    }
  | { connected: false }

// A status effect on the bot. `ticks` is how long it had left at `since` (ms); -1 means it doesn't end.
export type StatusEffect = {
  name: string
  label: string
  level: number
  good: boolean
  ticks: number
  since: number
}

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
  // The player who sent it, when it could be told, for drawing their head.
  player?: string
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
  blocks: string[]
  chests: { x: number; y: number; z: number }[]
  mined: number
  deposited: number
  status: string
}

// A user script (Scripts in the toolbar): JavaScript defining `async function start()` and optionally
// `async function stop()`, run with the `ryksu` API (see src/main/scripts/scriptApi.ts).
export type Script = { id: string; name: string; code: string }

export type ScriptLogEntry = { at: number; level: 'info' | 'error'; text: string }

export type ScriptsState = {
  scripts: Script[]
  // The script that's on (one at a time), what it last said it's doing, and whether it hid the world (the
  // game view shows a screen about the script instead, drawing nothing).
  // `toggles`: which automatic features are on now (the script's picks, not the user's).
  running: { id: string; status: string; worldHidden: boolean; toggles: Record<Automation, boolean> } | null
  // The latest lines scripts logged, oldest first.
  log: ScriptLogEntry[]
}

export type InventoryItem = {
  name: string
  displayName: string
  count: number
  // Only on items that wear out.
  durability?: { used: number; max: number }
  // Ready to show, e.g. "Sharpness V"; curses are drawn red.
  enchantments?: { label: string; curse?: boolean }[]
  // Blocks (and seeds, redstone, …) that build mode can place.
  placeable?: boolean
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
  blocks: BlockView | null
}

// The blocks around the bot the watcher draws (built by src/main/bot/world/worldCompute.ts).
export type BlockView = {
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
  // (see src/renderer/features/watcher/viewMode.ts).
  faces: number[]
  // Block light (0-15) for every cell of the view box, 255 where light can't enter. Cells are laid out
  // x fastest, then z, then y; `below` is the origin's layer.
  light: { width: number; height: number; below: number; cells: Uint8Array }
  // Point lights (torches, lanterns, …) as x, y, z (like positions) and level, four numbers each.
  emitters?: number[]
  roofCutoff: number
  // Where the bot is, for picking the view mode automatically.
  environment: 'outside' | 'indoors' | 'cave'
}

export type InventoryClick = { slot: number; button: number; mode: 0 | 1 | 2 | 4 }

// The tab list: players on now (`bot` marks ours), and remembered ones who aren't (`lastSeen` in ms).
export type PlayerList = {
  online: { name: string; uuid: string; ping: number | null; bot?: boolean }[]
  offline: { name: string; uuid: string; lastSeen: number | null }[]
}

// Build mode: break these blocks, or place the held block in these spots, in order. `face` is the face
// that was clicked (pointing out of the block it belongs to), so the first block goes against it.
export type BuildAction =
  | { type: 'break'; cells: { x: number; y: number; z: number }[] }
  | {
      type: 'place'
      cells: { x: number; y: number; z: number }[]
      face?: { x: number; y: number; z: number }
    }

// Blocks being broken right now (stage 0-9, the game's crack textures), and one the bot just finished.
export type BreakingState = {
  cracks: { x: number; y: number; z: number; stage: number }[]
  broken: { x: number; y: number; z: number; name: string } | null
}

// Blocks the bot still has to break and place (the line it's on and any queued after it).
export type BuildCells = {
  break: { x: number; y: number; z: number }[]
  place: { x: number; y: number; z: number }[]
}

// One offer from an open villager or wandering trader.
export type TradeOffer = {
  index: number
  // What the bot pays: the first item's count is the current price (after demand and discounts).
  inputs: NonNullable<InventoryItem>[]
  // The listed price before demand and discounts, to show a change.
  basePrice: number
  output: NonNullable<InventoryItem>
  uses: number
  maxUses: number
  // Sold out until the trader restocks.
  disabled: boolean
  // How many times the bot can make it right now with what it carries.
  affordable: number
}

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
  // First person: keep facing yaw/pitch and strafe with left/right, instead of turning to walk.
  pitch?: number
  relative?: boolean
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
  // On fire: its hitbox size, which the flames are drawn around.
  burning?: { width: number; height: number }
  // Sneaking (players), and sitting on command (cats, wolves, parrots).
  crouching?: boolean
  sitting?: boolean
  // Set while asleep: the yaw from the bed's foot to its head.
  sleeping?: number
  equipment?: Partial<Record<EquipmentSlot, WornItem>>
}

export type MotionEntity = EntityPose & {
  // Tamed pets and horses; pets also carry their owner.
  tamed?: boolean
  // `source`: online now, seen on this server before, or matched by hashing known names (offline mode).
  owner?: { uuid: string; name?: string; source?: 'online' | 'seen' | 'matched' }
  health?: number
  ping?: number
  // A player the bot takes gestures from.
  trusted?: boolean
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
  // Dye retained on a sheep's body after its wool is sheared.
  shearedColor?: string
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
  bot: EntityPose & {
    name?: string
    health?: number
    skin: string | null
    cape?: string | null
    slim: boolean
    walking?: boolean
  }
  entities: MotionEntity[]
  // Item frames nearby, drawn with what they hold (maps as their pixels, for map art walls).
  frames?: ItemFrame[]
}

// An item frame (or glow item frame). `facing` is the way it points out of the wall (0 down, 1 up,
// 2 north, 3 south, 4 west, 5 east); `rotation` is its 45° turns (0-7). `map` is a filled map it
// holds: its id and how many updates it has had, so the watcher knows when to fetch its pixels again.
export type ItemFrame = {
  id: number
  x: number
  y: number
  z: number
  facing: number
  rotation: number
  invisible?: boolean
  glow?: boolean
  item?: string
  map?: { id: number; version: number }
}

// A map's 128×128 color ids, row by row (see the map color table in the watcher).
export type MapPixels = { id: number; version: number; colors: Uint8Array }
