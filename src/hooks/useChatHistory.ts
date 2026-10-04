import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChatMessage } from '../types'
import { mergeChatHistory } from '../utils/chat'

type UseChatHistoryArgs = { chatStorageKey: string; connectionStartTimestamp: number | null }

const readHistory = (key: string): ChatMessage[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(saved) ? saved.filter(entry => entry && typeof entry.id === 'string' && typeof entry.text === 'string' && Number.isFinite(entry.timestamp)) : []
  } catch { return [] }
}

const useChatHistory = ({ chatStorageKey, connectionStartTimestamp }: UseChatHistoryArgs) => {
  const savedHistory = useMemo(() => readHistory(chatStorageKey), [chatStorageKey])
  const [state, setState] = useState(() => ({ key: chatStorageKey, messages: savedHistory }))
  const visibleChatMessages = state.key === chatStorageKey ? state.messages : savedHistory

  const addChatMessages = useCallback((incoming: ChatMessage | ChatMessage[]) => {
    const list = (Array.isArray(incoming) ? incoming : [incoming]).filter(entry =>
      !connectionStartTimestamp || entry.timestamp >= connectionStartTimestamp)
    if (!list.length) return
    setState(previous => ({ key: chatStorageKey, messages: mergeChatHistory(
      previous.key === chatStorageKey ? previous.messages : savedHistory, list) }))
  }, [chatStorageKey, connectionStartTimestamp, savedHistory])

  useEffect(() => {
    if (state.key !== chatStorageKey) return
    try { localStorage.setItem(chatStorageKey, JSON.stringify(state.messages)) }
    catch (error) { console.error('Failed to persist chat history for server', error) }
  }, [state, chatStorageKey])

  return { visibleChatMessages, addChatMessages }
}
export default useChatHistory
