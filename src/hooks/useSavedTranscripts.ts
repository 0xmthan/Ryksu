import { useCallback, useState } from 'react'
import type { AccountType, ChatMessage, StoredTranscriptMeta } from '../types'
import { CHAT_STORAGE_PREFIX } from '../utils/chat'

const useSavedTranscripts = () => {
  const [savedTranscripts, setSavedTranscripts] = useState<StoredTranscriptMeta[]>([])

  const loadSavedTranscripts = useCallback((): StoredTranscriptMeta[] => {
    const transcripts: StoredTranscriptMeta[] = []

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key || !key.startsWith(CHAT_STORAGE_PREFIX)) {
        continue
      }

      try {
        const raw = localStorage.getItem(key)
        if (!raw) {
          continue
        }

        const parsed = JSON.parse(raw) as ChatMessage[]
        const remainder = key.slice(CHAT_STORAGE_PREFIX.length)
        const parts = remainder.split(':')
        if (parts.length < 3) {
          continue
        }

        const typePart = parts[0] as AccountType
        const portPart = parts[parts.length - 1]
        const hostPart = parts.slice(1, -1).join(':') || 'unknown'
        const typeLabel = typePart === 'online' ? 'Online' : 'Offline'
        const label = `[${typeLabel}] ${hostPart}${portPart ? `:${portPart}` : ''}`

        transcripts.push({ key, label, messages: parsed })
      } catch (error) {
        console.error('Failed to parse saved transcript', key, error)
      }
    }

    transcripts.sort((a, b) => a.label.localeCompare(b.label))
    setSavedTranscripts(transcripts)
    return transcripts
  }, [])

  const deleteTranscript = useCallback(
    (key: string): boolean => {
      try {
        localStorage.removeItem(key)
      } catch (error) {
        console.error('Failed to delete transcript', key, error)
      }

      const updated = loadSavedTranscripts()
      return updated.length > 0
    },
    [loadSavedTranscripts]
  )

  return { savedTranscripts, loadSavedTranscripts, deleteTranscript }
}

export default useSavedTranscripts
