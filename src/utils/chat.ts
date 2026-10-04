import type { AccountType, ChatMessage } from '../types'

export const STORAGE_KEY = 'ryksu:lastConnection'
export const CHAT_STORAGE_PREFIX = 'ryksu:chat:'

export const normalizeHost = (value: string) => {
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : 'localhost'
}

export const normalizePort = (value: string) => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : '25565'
}

export const makeChatStorageKey = (type: AccountType, host: string, port: string) =>
  `${CHAT_STORAGE_PREFIX}${type}:${normalizeHost(host)}:${normalizePort(port)}`

export const mergeChatHistory = (existing: ChatMessage[], incoming: ChatMessage[]) => {
  if (incoming.length === 0) {
    return existing
  }

  const map = new Map<string, ChatMessage>()
  for (const entry of existing) {
    map.set(entry.id, entry)
  }

  for (const entry of incoming) {
    map.set(entry.id, entry)
  }

  const merged = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp)
  return merged
}

export const normalizeProtocolError = (message?: string | null): string | null => {
  if (!message) {
    return message ?? null
  }

  if (
    message.includes('Chunk size is') &&
    message.includes('partial packet') &&
    message.includes('"name":"player_info"')
  ) {
    return 'The server or one of its plugins sent a packet Ryksu could not parse.'
  }

  if (message.includes('Unsupported protocol version')) {
    return 'The server is running a newer Minecraft version. Pick the matching version above and try again.'
  }

  return message
}
