import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import ConnectionForm from './components/ConnectionForm'
import StatsView from './components/StatsView'
import TitleBar from './components/TitleBar'
import type { AccountType, BotSnapshot, BotStatus, LastConnection, ChatMessage } from './types/bot'

const STORAGE_KEY = 'ryksu:lastConnection'

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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isSendingChat, setIsSendingChat] = useState(false)

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

        setLastConnection({
          host: parsed.host ?? 'localhost',
          port: parsed.port ?? '25565',
          username: parsed.username ?? 'Ryksu',
          accountType: (parsed.accountType as AccountType) ?? 'offline',
          version: parsed.version,
        })
      }
    } catch (error) {
      console.error('Failed to load saved connection details', error)
    } finally {
      setHasLoadedPreferences(true)
    }
  }, [])

  useEffect(() => {
    const unsubscribeChat = window.electronAPI.bot.onChat((entry: ChatMessage) => {
      setChatMessages((previous) => [...previous.slice(-199), entry])
    })

    const unsubscribeHistory = window.electronAPI.bot.onChatHistory((history: ChatMessage[]) => {
      if (Array.isArray(history)) {
        setChatMessages(history.slice(-200))
      }
    })

    window.electronAPI.bot
      .getChatHistory()
      .then((history) => {
        if (Array.isArray(history) && history.length > 0) {
          setChatMessages(history.slice(-200))
        }
      })
      .catch((error) => {
        console.error('Failed to load chat history', error)
      })

    return () => {
      unsubscribeChat()
      unsubscribeHistory()
    }
  }, [])

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
    if (!hasLoadedPreferences) {
      return
    }

    const payload: LastConnection = {
      host,
      port,
      username,
      accountType,
      version,
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      setLastConnection(payload)
    } catch (error) {
      console.error('Failed to persist connection details', error)
    }
  }, [accountType, host, port, username, version, hasLoadedPreferences])

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

  const attemptConnect = async (details: {
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
  }

  const handleConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await attemptConnect({
      host,
      port,
      username,
      accountType,
      onlinePassword,
      offlinePassword,
      version,
    })
  }

  const handleDisconnect = async () => {
    await window.electronAPI.bot.disconnect()
    setBotState({ connected: false })
    setStatus({ stage: 'disconnected', message: 'Bot disconnected.' })
    setIsConnecting(false)
    setChatMessages([])
  }

  const handleConnectToLast = async () => {
    if (!lastConnection) {
      return
    }

    const nextVersion = lastConnection.version ?? 'auto'

    setAccountType(lastConnection.accountType)
    setHost(lastConnection.host)
    setPort(lastConnection.port)
    setUsername(lastConnection.username)
    setVersion(nextVersion)

    await attemptConnect({
      host: lastConnection.host,
      port: lastConnection.port,
      username: lastConnection.username,
      accountType: lastConnection.accountType,
      onlinePassword,
      offlinePassword,
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
    setChatMessages((previous) => [...previous.slice(-199), entry])
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

  const lastConnectionSummary = useMemo(() => {
    if (!lastConnection) {
      return null
    }

    const labelAccount = lastConnection.accountType === 'online' ? 'Online' : 'Offline'
    const labelVersion =
      !lastConnection.version || lastConnection.version === 'auto'
        ? 'Auto'
        : `Version ${lastConnection.version}`

    const labelUsername = lastConnection.username ? `as ${lastConnection.username}` : 'with unnamed bot'
    const labelHost = `${lastConnection.host}${lastConnection.port ? `:${lastConnection.port}` : ''}`

    return `${labelAccount} ${labelUsername} on ${labelHost} • ${labelVersion}`
  }, [lastConnection])

  const currentFieldsSummary = useMemo(() => {
    const labelAccount = accountType === 'online' ? 'Online' : 'Offline'
    const labelUsername = username ? `as ${username}` : 'with unnamed bot'
    const labelHost = `${host}${port ? `:${port}` : ''}`
    const labelVersion = !version || version === 'auto' ? 'Auto' : `Version ${version}`

    return `${labelAccount} ${labelUsername} on ${labelHost} • ${labelVersion}`
  }, [accountType, host, port, username, version])

  return (
    <div className="flex min-h-screen flex-col bg-app text-purple-100">
      <TitleBar />
      <main className="flex flex-1">
        {isConnected && connectedState ? (
          <StatsView
            snapshot={connectedState}
            status={status}
            onDisconnect={handleDisconnect}
            chatMessages={chatMessages}
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
            status={status}
            lastError={lastError}
            isConnecting={isConnecting}
            lastConnection={lastConnection}
            lastConnectionSummary={lastConnectionSummary}
            currentFieldsSummary={currentFieldsSummary}
            onAccountTypeChange={setAccountType}
            onHostChange={setHost}
            onPortChange={setPort}
            onUsernameChange={setUsername}
            onOnlinePasswordChange={setOnlinePassword}
            onOfflinePasswordChange={setOfflinePassword}
            onVersionChange={setVersion}
            onSubmit={handleConnect}
            onConnectToLast={handleConnectToLast}
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
