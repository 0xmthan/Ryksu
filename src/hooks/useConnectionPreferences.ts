import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react'
import type { AccountType, LastConnection as LastConnectionType } from '../types'
import { STORAGE_KEY } from '../utils/chat'

type UseConnectionPreferencesArgs = {
  accountType: AccountType
  host: string
  port: string
  username: string
  version: string
  offlinePassword: string
  setAccountType: Dispatch<SetStateAction<AccountType>>
  setHost: Dispatch<SetStateAction<string>>
  setPort: Dispatch<SetStateAction<string>>
  setUsername: Dispatch<SetStateAction<string>>
  setVersion: Dispatch<SetStateAction<string>>
  setOfflinePassword: Dispatch<SetStateAction<string>>
}

const useConnectionPreferences = ({
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
}: UseConnectionPreferencesArgs) => {
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false)
  const [lastConnection, setLastConnection] = useState<LastConnectionType | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<LastConnectionType>
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
  }, [setAccountType, setHost, setOfflinePassword, setPort, setUsername, setVersion])

  const persist = useCallback(() => {
    if (!hasLoadedPreferences) {
      return
    }

    const payload: LastConnectionType = {
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
  }, [accountType, hasLoadedPreferences, host, offlinePassword, port, username, version])

  return { lastConnection, persist, hasLoadedPreferences }
}

export default useConnectionPreferences
