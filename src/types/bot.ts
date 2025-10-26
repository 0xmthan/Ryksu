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
