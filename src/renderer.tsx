import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import ConnectionForm from './components/ConnectionForm'
import Dashboard from './components/Dashboard'
import TitleBar from './components/TitleBar'
import type { AccountType, BotSnapshot, BotStatus, LastConnection, ChatMessage } from './types/bot'

const STORAGE_KEY = 'ryksu:lastConnection'
const CHAT_STORAGE_PREFIX = 'ryksu:chat:'
const CHAT_PAGE_SIZE = 50
const CHAT_HISTORY_LIMIT = 2000

const normalizeHost = (value: string) => {
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : 'localhost'
}

const normalizePort = (value: string) => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : '25565'
}

const makeChatStorageKey = (type: AccountType, host: string, port: string) =>
  `${CHAT_STORAGE_PREFIX}${type}:${normalizeHost(host)}:${normalizePort(port)}`

const mergeChatHistory = (existing: ChatMessage[], incoming: ChatMessage[]) => {
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
  if (merged.length > CHAT_HISTORY_LIMIT) {
    return merged.slice(-CHAT_HISTORY_LIMIT)
  }
  return merged
}

const normalizeProtocolError = (message?: string | null): string | null => {
  if (!message) {
    return message ?? null
  }

  if (message.includes('Unsupported protocol version')) {
    return 'The server is running a newer Minecraft version. Pick the matching version above and try again.'
  }

  return message
}

const App: React.FC = () => {
  const [accountType, setAccountType] = useState<AccountType>('offline')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('25565')
  const [username, setUsername] = useState('')
  const [onlinePassword, setOnlinePassword] = useState('')
  const [offlinePassword, setOfflinePassword] = useState('')
  const [status, setStatus] = useState<BotStatus>(null)
  const [botState, setBotState] = useState<BotSnapshot>({ connected: false })
  const [isConnecting, setIsConnecting] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [availableVersions, setAvailableVersions] = useState<string[]>([])
  const [version, setVersion] = useState<string>('auto')
  const [lastConnection, setLastConnection] = useState<LastConnection | null>(null)
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false)
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [chatVisibleCount, setChatVisibleCount] = useState<number>(0)
  const [chatInput, setChatInput] = useState('')
  const [isSendingChat, setIsSendingChat] = useState(false)
  const chatLoadedRef = useRef(false)
  const [activeConnectionKey, setActiveConnectionKey] = useState<string | null>(null)

  const computedChatKey = useMemo(
    () => makeChatStorageKey(accountType, host, port),
    [accountType, host, port]
  )
  const chatStorageKey = activeConnectionKey ?? computedChatKey

  const visibleChatMessages = useMemo(() => {
    if (chatHistory.length === 0) {
      return [] as ChatMessage[]
    }

    const baseline =
      chatVisibleCount > 0
        ? Math.min(chatVisibleCount, chatHistory.length)
        : Math.min(CHAT_PAGE_SIZE, chatHistory.length)

    return chatHistory.slice(-baseline)
  }, [chatHistory, chatVisibleCount])

  const hasOlderChat = chatHistory.length > visibleChatMessages.length

  const loadOlderChat = useCallback(() => {
    if (chatHistory.length === 0) {
      return 0
    }

    let added = 0
    setChatVisibleCount((current) => {
      const baseline = current > 0 ? current : Math.min(CHAT_PAGE_SIZE, chatHistory.length)
      const next = Math.min(baseline + CHAT_PAGE_SIZE, chatHistory.length)
      added = next - baseline
      return next
    })
    return added
  }, [chatHistory.length])

  const addChatMessages = useCallback((incoming: ChatMessage | ChatMessage[]) => {
    const list = Array.isArray(incoming) ? incoming : [incoming]
    if (list.length === 0) {
      return
    }

    setChatHistory((previous) => mergeChatHistory(previous, list))
  }, [])

  const persistCurrentConnection = useCallback(() => {
    if (!hasLoadedPreferences) {
      return
    }

    const payload: LastConnection = {
      host,
      port,
      username,
      accountType,
      version,
      offlinePassword: accountType === 'offline' ? offlinePassword : undefined,
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      setLastConnection(payload)
    } catch (error) {
      console.error('Failed to persist connection details', error)
    }
  }, [accountType, host, offlinePassword, port, username, version, hasLoadedPreferences])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<LastConnection>
        if (parsed.accountType === 'online' || parsed.accountType === 'offline') {
          setAccountType(parsed.accountType)
        }
        if (typeof parsed.host === 'string' && parsed.host.trim().length > 0) {
          setHost(parsed.host)
        }
        if (typeof parsed.port === 'string' && parsed.port.trim().length > 0) {
          setPort(parsed.port)
        }
        if (typeof parsed.username === 'string') {
          setUsername(parsed.username)
        }
        if (typeof parsed.version === 'string') {
          setVersion(parsed.version)
        }
        if (typeof parsed.offlinePassword === 'string') {
          setOfflinePassword(parsed.offlinePassword)
        }

        setLastConnection({
          host: parsed.host ?? 'localhost',
          port: parsed.port ?? '25565',
          username: parsed.username ?? 'Ryksu',
          accountType: (parsed.accountType as AccountType) ?? 'offline',
          version: parsed.version,
          offlinePassword: parsed.offlinePassword,
        })
      }
    } catch (error) {
      console.error('Failed to load saved connection details', error)
    } finally {
      setHasLoadedPreferences(true)
    }
  }, [])

  useEffect(() => {
    chatLoadedRef.current = false
    try {
      const raw = localStorage.getItem(chatStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[]
        const truncated = mergeChatHistory([], parsed)
        setChatHistory(truncated)
        setChatVisibleCount(truncated.length === 0 ? 0 : Math.min(truncated.length, CHAT_PAGE_SIZE))
      } else {
        setChatHistory([])
        setChatVisibleCount(0)
      }
    } catch (error) {
      console.error('Failed to load chat history for server', error)
      setChatHistory([])
      setChatVisibleCount(0)
    } finally {
      chatLoadedRef.current = true
    }
  }, [chatStorageKey])

  useEffect(() => {
    if (!chatLoadedRef.current) {
      return
    }

    try {
      localStorage.setItem(chatStorageKey, JSON.stringify(chatHistory))
    } catch (error) {
      console.error('Failed to persist chat history for server', error)
    }
  }, [chatHistory, chatStorageKey])

  useEffect(() => {
    const unsubscribeChat = window.electronAPI.bot.onChat((entry: ChatMessage) => {
      addChatMessages(entry)
    })

    const unsubscribeHistory = window.electronAPI.bot.onChatHistory((history: ChatMessage[]) => {
      if (Array.isArray(history)) {
        addChatMessages(history)
      }
    })

    window.electronAPI.bot
      .getChatHistory()
      .then((history) => {
        if (Array.isArray(history) && history.length > 0) {
          addChatMessages(history)
        }
      })
      .catch((error) => {
        console.error('Failed to load chat history', error)
      })

    return () => {
      unsubscribeChat()
      unsubscribeHistory()
    }
  }, [addChatMessages])

  useEffect(() => {
    const unsubscribeStatus = window.electronAPI.bot.onStatus((incomingStatus) => {
      const resolvedMessage = normalizeProtocolError(incomingStatus.message)
      setStatus({ ...incomingStatus, message: resolvedMessage ?? undefined })

      if (incomingStatus.stage === 'connected') {
        setIsConnecting(false)
        setLastError(null)
      }

      if (incomingStatus.stage === 'error' || incomingStatus.stage === 'kicked') {
        setIsConnecting(false)
        setLastError(resolvedMessage ?? 'The bot was kicked or encountered an error.')
        setBotState({ connected: false })
        pushSystemChat(
          resolvedMessage ??
            (incomingStatus.stage === 'kicked'
              ? 'Bot was kicked from the server.'
              : 'Bot encountered an error and disconnected.')
        )
      }

      if (incomingStatus.stage === 'disconnected') {
        setIsConnecting(false)
        setBotState({ connected: false })
        pushSystemChat(resolvedMessage ?? 'Bot disconnected.')
      }
    })

    const unsubscribeState = window.electronAPI.bot.onState((state) => {
      setBotState(state)
    })

    window.electronAPI.bot.subscribe()

    return () => {
      unsubscribeStatus()
      unsubscribeState()
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    const fetchVersions = async () => {
      try {
        const versions = await window.electronAPI.bot.getSupportedVersions()
        if (!isMounted) {
          return
        }

        setAvailableVersions(versions)
        if (versions.length > 0) {
          setVersion((current) => (current === 'auto' ? versions[0] : current))
        }
      } catch (error) {
        console.error('Failed to load supported versions', error)
      }
    }

    fetchVersions()

    return () => {
      isMounted = false
    }
  }, [])

  const attemptConnect = useCallback(
    async (details: {
      host: string
      port: string
      username: string
      accountType: AccountType
      onlinePassword?: string
      offlinePassword?: string
      version: string
    }) => {
      setIsConnecting(true)
      setLastError(null)

      const response = await window.electronAPI.bot.connect({
        host: details.host,
        port: details.port,
        username: details.username,
        accountType: details.accountType,
        password: details.accountType === 'online' ? details.onlinePassword : undefined,
        offlinePassword: details.accountType === 'offline' ? details.offlinePassword : undefined,
        version: details.version,
      })

      if (!response.ok) {
        setIsConnecting(false)
        setLastError(normalizeProtocolError(response.message) ?? 'Failed to connect to the server.')
      }
    },
    []
  )

  const connectWithCurrentFields = useCallback(async () => {
    const nextKey = makeChatStorageKey(accountType, host, port)
    setActiveConnectionKey(nextKey)
    persistCurrentConnection()
    await attemptConnect({
      host,
      port,
      username,
      accountType,
      onlinePassword,
      offlinePassword,
      version,
    })
  }, [
    accountType,
    attemptConnect,
    host,
    offlinePassword,
    onlinePassword,
    persistCurrentConnection,
    port,
    username,
    setActiveConnectionKey,
    version,
  ])

  const handleConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await connectWithCurrentFields()
  }

  const handleDisconnect = async () => {
    await window.electronAPI.bot.disconnect()
    setBotState({ connected: false })
    setStatus({ stage: 'disconnected', message: 'Bot disconnected.' })
    setIsConnecting(false)
    setActiveConnectionKey(null)
  }

  const handleConnectToLast = async () => {
    if (!lastConnection) {
      return
    }

    const nextVersion = lastConnection.version ?? 'auto'
    const nextOfflinePassword = lastConnection.offlinePassword ?? ''
    const connectionKey = makeChatStorageKey(
      lastConnection.accountType,
      lastConnection.host,
      lastConnection.port
    )

    setAccountType(lastConnection.accountType)
    setHost(lastConnection.host)
    setPort(lastConnection.port)
    setUsername(lastConnection.username)
    setVersion(nextVersion)
    setOfflinePassword(nextOfflinePassword)
    setActiveConnectionKey(connectionKey)

    await attemptConnect({
      host: lastConnection.host,
      port: lastConnection.port,
      username: lastConnection.username,
      accountType: lastConnection.accountType,
      onlinePassword,
      offlinePassword: nextOfflinePassword,
      version: nextVersion,
    })
  }

  const pushSystemChat = (text: string) => {
    const entry: ChatMessage = {
      id: `${Date.now()}-local`,
      text,
      author: 'Ryksu',
      type: 'system',
      position: 'client',
      timestamp: Date.now(),
    }
    addChatMessages(entry)
  }

  const handleChatSubmit = async () => {
    const trimmed = chatInput.trim()
    if (!trimmed) {
      return
    }

    setIsSendingChat(true)
    setLastError(null)
    try {
      const response = await window.electronAPI.bot.sendChat(trimmed)
      if (!response?.ok) {
        const errorMessage = response?.message ?? 'Failed to send chat message.'
        pushSystemChat(errorMessage)
        return
      }
      setChatInput('')
    } catch (error) {
      console.error('Failed to send chat message', error)
      pushSystemChat('Failed to send chat message.')
    } finally {
      setIsSendingChat(false)
    }
  }

  const connectedState = botState.connected ? botState : null
  const isConnected = Boolean(connectedState)
  const canAttemptConnect = host.trim().length > 0 && username.trim().length > 0

  return (
    <div className="flex min-h-screen flex-col bg-app text-purple-100">
      <div className="sticky top-0 z-50">
        <TitleBar
          status={status}
          lastError={lastError}
          isConnecting={isConnecting}
          isConnected={isConnected}
          canConnect={canAttemptConnect}
          onConnect={connectWithCurrentFields}
          onDisconnect={handleDisconnect}
        />
      </div>
      <main className="flex flex-1">
        {isConnected && connectedState ? (
          <Dashboard
            snapshot={connectedState}
            chatMessages={visibleChatMessages}
            hasOlderMessages={hasOlderChat}
            onLoadOlderMessages={loadOlderChat}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onChatSubmit={handleChatSubmit}
            isSendingChat={isSendingChat}
          />
        ) : (
          <ConnectionForm
            accountType={accountType}
            host={host}
            port={port}
            username={username}
            onlinePassword={onlinePassword}
            offlinePassword={offlinePassword}
            version={version}
            availableVersions={availableVersions}
            lastConnection={lastConnection}
            onAccountTypeChange={setAccountType}
            onHostChange={setHost}
            onPortChange={setPort}
            onUsernameChange={setUsername}
            onOnlinePasswordChange={setOnlinePassword}
            onOfflinePasswordChange={setOfflinePassword}
            onVersionChange={setVersion}
            onSubmit={handleConnect}
            onCommitEdit={persistCurrentConnection}
          />
        )}
      </main>
    </div>
  )
}

const container = document.getElementById('root')

if (!container) {
  throw new Error('Failed to find the root element')
}

const root = createRoot(container)
root.render(<App />)
