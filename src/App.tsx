import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ConnectionForm from './components/ConnectionForm'
import Dashboard from './components/Dashboard'
import SavedChats from './components/SavedChats'
import TitleBar from './components/TitleBar'
import AutoEatSettingsModal from './components/AutoEatSettingsModal'
import PvpSettingsModal from './components/PvpSettingsModal'
import useChatHistory from './hooks/useChatHistory'
import useConnectionPreferences from './hooks/useConnectionPreferences'
import usePluginControls from './hooks/usePluginControls'
import useSavedTranscripts from './hooks/useSavedTranscripts'
import type {
  AccountType,
  AutoEatOptions,
  BotSnapshot,
  BotStatus,
  ChatMessage,
  PathfinderOptions,
} from './types'
import { makeChatStorageKey, normalizeProtocolError } from './utils/chat'

const App: React.FC = () => {
  const [accountType, setAccountType] = useState<AccountType>('offline')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('25565')
  const [username, setUsername] = useState('')
  const [onlinePassword, setOnlinePassword] = useState('')
  const [offlinePassword, setOfflinePassword] = useState('')
  const [status, setStatus] = useState<BotStatus>(null)
  const [botState, setBotState] = useState<BotSnapshot>({ connected: false })
  const isConnected = botState.connected
  const [isConnecting, setIsConnecting] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [availableVersions, setAvailableVersions] = useState<string[]>([])
  const [version, setVersion] = useState<string>('auto')
  const [isChatPanelOpen, setIsChatPanelOpen] = useState(false)
  const [isViewingSavedChats, setIsViewingSavedChats] = useState(false)
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [activeConnectionKey, setActiveConnectionKey] = useState<string | null>(null)
  const [connectionStartTimestamp, setConnectionStartTimestamp] = useState<number | null>(null)
  const [isAutoEatModalOpen, setIsAutoEatModalOpen] = useState(false)
  const [isPvpSettingsModalOpen, setIsPvpSettingsModalOpen] = useState(false)
  const {
    armorManagerEnabled,
    autoEatEnabled,
    autoEatOptions,
    toggleArmorManager,
    toggleAutoEat,
    autoToolEnabled,
    toggleAutoTool,
    autoShieldEnabled,
    toggleAutoShield,
    updateAutoEatOptions,
    pathfinder,
    updatePathfinder,
    pvpEnabled,
    togglePvp,
    pvpPlayerEnabled,
    pvpPlayerTarget,
    togglePvpPlayer,
    updatePvpPlayerTarget,
    pvpOptions,
    updatePvpOptions,
  } = usePluginControls()

  const computedChatKey = useMemo(
    () => makeChatStorageKey(accountType, host, port),
    [accountType, host, port]
  )
  const chatStorageKey = activeConnectionKey ?? computedChatKey

  const { savedTranscripts, loadSavedTranscripts, deleteTranscript } = useSavedTranscripts()

  const { visibleChatMessages, addChatMessages } = useChatHistory({
    chatStorageKey,
    connectionStartTimestamp,
  })

  const { lastConnection, persist: persistCurrentConnection } = useConnectionPreferences({
    accountType,
    host,
    port,
    username,
    version,
    offlinePassword,
    setAccountType,
    setHost,
    setPort,
    setUsername,
    setVersion,
    setOfflinePassword,
  })

  const handleTitleBarToggle = useCallback(() => {
    if (isConnected) {
      setIsChatPanelOpen((previous) => !previous)
      setIsViewingSavedChats(false)
    } else {
      setIsChatPanelOpen(false)
      setIsViewingSavedChats((previous) => {
        if (previous) {
          return false
        }
        loadSavedTranscripts()
        return true
      })
    }
  }, [isConnected, loadSavedTranscripts])

  const handleDeleteTranscript = useCallback(
    (key: string) => {
      const hasTranscripts = deleteTranscript(key)
      if (!hasTranscripts) {
        setIsViewingSavedChats(false)
      }
    },
    [deleteTranscript]
  )

  const attemptConnect = useCallback(
    async (details: {
      host: string
      port: string
      username: string
      accountType: AccountType
      onlinePassword?: string
      offlinePassword?: string
      version: string
      armorManagerEnabled: boolean
      autoEatEnabled: boolean
      autoEatOptions: AutoEatOptions
      pathfinder: PathfinderOptions
      pvpEnabled: boolean
      pvpPlayerEnabled: boolean
      pvpPlayerTarget: string
      mobMovementEnabled: boolean
      allowBlockBreak: boolean
      jumpAttackEnabled: boolean
      autoToolEnabled: boolean
      autoShieldEnabled: boolean
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
        armorManagerEnabled: details.armorManagerEnabled,
        autoEatEnabled: details.autoEatEnabled,
        autoEatOptions: details.autoEatOptions,
        autoToolEnabled: details.autoToolEnabled,
        autoShieldEnabled: details.autoShieldEnabled,
        pathfinder: details.pathfinder,
        pvp: {
          mobEnabled: details.pvpEnabled,
          playerEnabled: details.pvpEnabled && details.pvpPlayerEnabled,
          playerTarget: details.pvpPlayerEnabled ? details.pvpPlayerTarget : undefined,
          mobMovementEnabled: details.mobMovementEnabled,
          allowBlockBreak: details.allowBlockBreak,
          jumpAttackEnabled: details.jumpAttackEnabled,
        },
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
      armorManagerEnabled,
      autoEatEnabled,
      autoEatOptions,
      jumpAttackEnabled: pvpOptions.jumpAttackEnabled,
      autoToolEnabled,
      autoShieldEnabled,
      pvpEnabled,
      pvpPlayerEnabled,
      pvpPlayerTarget,
      mobMovementEnabled: pvpOptions.mobMovementEnabled,
      allowBlockBreak: pvpOptions.allowBlockBreak,
      pathfinder,
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
    version,
    armorManagerEnabled,
    autoEatEnabled,
    autoEatOptions,
    pvpOptions.jumpAttackEnabled,
    autoToolEnabled,
    autoShieldEnabled,
    pvpEnabled,
    pvpPlayerEnabled,
    pvpPlayerTarget,
    pvpOptions.mobMovementEnabled,
    pvpOptions.allowBlockBreak,
    pathfinder,
  ])

  const handleConnect: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    await connectWithCurrentFields()
  }

  const handleDisconnect = useCallback(async () => {
    await window.electronAPI.bot.disconnect()
    setBotState({ connected: false })
    setStatus({ stage: 'disconnected', message: 'Bot disconnected.' })
    setIsConnecting(false)
    setActiveConnectionKey(null)
  }, [])

  const pushSystemChat = useCallback(
    (text: string) => {
      const entry: ChatMessage = {
        id: `${Date.now()}-local`,
        text,
        author: 'Ryksu',
        type: 'system',
        position: 'client',
        timestamp: Date.now(),
      }
      addChatMessages(entry)
    },
    [addChatMessages]
  )

  const handleChatSubmit = useCallback(async () => {
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
  }, [chatInput, pushSystemChat])

  const handleOpenAutoEatSettings = useCallback(() => {
    setIsAutoEatModalOpen(true)
  }, [])

  const handleCloseAutoEatSettings = useCallback(() => {
    setIsAutoEatModalOpen(false)
  }, [])

  const handleOpenPvpSettings = useCallback(() => {
    setIsPvpSettingsModalOpen(true)
  }, [])

  const handleClosePvpSettings = useCallback(() => {
    setIsPvpSettingsModalOpen(false)
  }, [])

  const handleAutoEatOptionsSave = useCallback(
    async (nextOptions: AutoEatOptions) => {
      const resolvedOptions = await updateAutoEatOptions(nextOptions)
      if (resolvedOptions) {
        setIsAutoEatModalOpen(false)
      }
    },
    [updateAutoEatOptions]
  )

  const handlePvpSettingsSave = useCallback(
    async (settings: { mobMovementEnabled: boolean }) => {
      await updatePvpOptions(settings)
      setIsPvpSettingsModalOpen(false)
    },
    [updatePvpOptions]
  )

  const handleAllowBlockBreakToggle = useCallback(
    async (enabled: boolean) => {
      await updatePvpOptions({ allowBlockBreak: enabled })
    },
    [updatePvpOptions]
  )

  const handleJumpAttackToggle = useCallback(
    async (enabled: boolean) => {
      await updatePvpOptions({ jumpAttackEnabled: enabled })
    },
    [updatePvpOptions]
  )

  const handlePathfinderTargetChange = useCallback(
    (target: string) => {
      updatePathfinder({ ...pathfinder, followTarget: target })
    },
    [pathfinder, updatePathfinder]
  )

  const handlePathfinderToggle = useCallback(
    (enabled: boolean) => {
      updatePathfinder({ ...pathfinder, followEnabled: enabled })
    },
    [pathfinder, updatePathfinder]
  )

  const connectedState = isConnected ? (botState as Extract<BotSnapshot, { connected: true }>) : null
  const canAttemptConnect = host.trim().length > 0 && username.trim().length > 0

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
        setConnectionStartTimestamp((previous) => previous ?? Date.now())
      }

      if (incomingStatus.stage === 'error' || incomingStatus.stage === 'kicked') {
        setIsConnecting(false)
        setConnectionStartTimestamp(null)
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
        setConnectionStartTimestamp(null)
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
  }, [pushSystemChat])

  useEffect(() => {
    let isMounted = true
    const fetchVersions = async () => {
      try {
        const versions = await window.electronAPI.bot.getSupportedVersions()
        if (!isMounted) {
          return
        }

        setAvailableVersions(versions)
      } catch (error) {
        console.error('Failed to load supported versions', error)
      }
    }

    fetchVersions()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!isConnected) {
      setIsChatPanelOpen(false)
    } else {
      setIsViewingSavedChats(false)
    }
  }, [isConnected])

  return (
    <div className="flex min-h-screen flex-col bg-app text-purple-100">
      <div className="fixed inset-x-0 top-0 z-50">
        <TitleBar
          status={status}
          lastError={lastError}
          isConnecting={isConnecting}
          isConnected={isConnected}
          canConnect={canAttemptConnect}
          onConnect={connectWithCurrentFields}
          onDisconnect={handleDisconnect}
          onToggleChat={handleTitleBarToggle}
          isChatActive={isConnected ? isChatPanelOpen : isViewingSavedChats}
        />
      </div>
      <main className="flex flex-1 overflow-y-auto pt-12">
        {isConnected && connectedState ? (
          <Dashboard
            snapshot={connectedState}
            chatMessages={visibleChatMessages}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onChatSubmit={handleChatSubmit}
            isSendingChat={isSendingChat}
            showChat={isChatPanelOpen}
            armorManagerEnabled={armorManagerEnabled}
            onArmorManagerToggle={toggleArmorManager}
            autoEatEnabled={autoEatEnabled}
            onAutoEatToggle={toggleAutoEat}
            onAutoEatConfigure={handleOpenAutoEatSettings}
            autoToolEnabled={autoToolEnabled}
            onAutoToolToggle={toggleAutoTool}
            autoShieldEnabled={autoShieldEnabled}
            onAutoShieldToggle={toggleAutoShield}
            pathfinderEnabled={pathfinder.followEnabled}
            pathfinderTarget={pathfinder.followTarget}
            pathfinder={pathfinder}
            onPathfinderToggle={handlePathfinderToggle}
            onPathfinderTargetChange={handlePathfinderTargetChange}
            updatePathfinder={updatePathfinder}
            pvpEnabled={pvpEnabled}
            onPvpToggle={togglePvp}
            onPvpConfigure={handleOpenPvpSettings}
            allowBlockBreak={pvpOptions.allowBlockBreak}
            onAllowBlockBreakToggle={handleAllowBlockBreakToggle}
            jumpAttackEnabled={pvpOptions.jumpAttackEnabled}
            onJumpAttackToggle={handleJumpAttackToggle}
            pvpPlayerEnabled={pvpPlayerEnabled}
            pvpPlayerTarget={pvpPlayerTarget}
            onPvpPlayerToggle={togglePvpPlayer}
            onPvpPlayerTargetChange={updatePvpPlayerTarget}
          />
        ) : isViewingSavedChats ? (
          <SavedChats transcripts={savedTranscripts} onDelete={handleDeleteTranscript} />
        ) : (
          <ConnectionForm
            status={status}
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
      {isAutoEatModalOpen ? (
        <AutoEatSettingsModal
          options={autoEatOptions}
          onClose={handleCloseAutoEatSettings}
          onSave={handleAutoEatOptionsSave}
        />
      ) : null}
      {isPvpSettingsModalOpen ? (
        <PvpSettingsModal
          options={pvpOptions}
          onClose={handleClosePvpSettings}
          onSave={handlePvpSettingsSave}
        />
      ) : null}
    </div>
  )
}

export default App
