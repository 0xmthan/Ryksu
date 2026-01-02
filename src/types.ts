export type AccountType = 'offline' | 'online'

export type BotStatusPayload = {
  stage: string
  message?: string
}

export type BotStatus = BotStatusPayload | null

export type BotSnapshot =
  | {
      connected: true
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
