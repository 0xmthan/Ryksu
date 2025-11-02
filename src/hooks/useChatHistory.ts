import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChatMessage } from '../types'
import { CHAT_PAGE_SIZE, mergeChatHistory } from '../utils/chat'

type UseChatHistoryArgs = {
  chatStorageKey: string
  connectionStartTimestamp: number | null
}

const useChatHistory = ({ chatStorageKey, connectionStartTimestamp }: UseChatHistoryArgs) => {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])

  const addChatMessages = useCallback(
    (incoming: ChatMessage | ChatMessage[]) => {
      const list = (Array.isArray(incoming) ? incoming : [incoming]).filter((entry) => {
        // If we don't have a connection start timestamp yet, accept incoming messages.
        // Otherwise only accept messages that occurred at/after the connection start.
        if (!connectionStartTimestamp) {
          return true
        }
        return entry.timestamp >= connectionStartTimestamp
      })

      if (list.length === 0) {
        return
      }

      setChatHistory((previous) => mergeChatHistory(previous, list))
    },
    [connectionStartTimestamp]
  )

  const visibleChatMessages = useMemo(() => {
    if (chatHistory.length === 0) {
      return [] as ChatMessage[]
    }

    return chatHistory.slice(-CHAT_PAGE_SIZE)
  }, [chatHistory])

  useEffect(() => {
    try {
      const existingRaw = localStorage.getItem(chatStorageKey)
      const existing = existingRaw ? (JSON.parse(existingRaw) as ChatMessage[]) : []
      const merged = mergeChatHistory(existing, chatHistory)
      localStorage.setItem(chatStorageKey, JSON.stringify(merged))
    } catch (error) {
      console.error('Failed to persist chat history for server', error)
    }
  }, [chatHistory, chatStorageKey])

  return {
    visibleChatMessages,
    addChatMessages,
  }
}

export default useChatHistory
