import React, { useEffect, useMemo, useState } from 'react'

import type { AccountType, BotStatus, LastConnection } from '../types/bot'

type ConnectionFormProps = {
  accountType: AccountType
  host: string
  port: string
  username: string
  onlinePassword: string
  offlinePassword: string
  version: string
  availableVersions: string[]
  status: BotStatus
  lastError: string | null
  isConnecting: boolean
  lastConnection: LastConnection | null
  lastConnectionSummary: string | null
  currentFieldsSummary: string
  onAccountTypeChange: (type: AccountType) => void
  onHostChange: (value: string) => void
  onPortChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onOnlinePasswordChange: (value: string) => void
  onOfflinePasswordChange: (value: string) => void
  onVersionChange: (value: string) => void
  onSubmit: React.FormEventHandler<HTMLFormElement>
  onConnectToLast: () => void
}

const ConnectionForm: React.FC<ConnectionFormProps> = ({
  accountType,
  host,
  port,
  username,
  onlinePassword,
  offlinePassword,
  version,
  availableVersions,
  status,
  lastError,
  isConnecting,
  lastConnection,
  lastConnectionSummary,
  onAccountTypeChange,
  onHostChange,
  onPortChange,
  onUsernameChange,
  onOnlinePasswordChange,
  onOfflinePasswordChange,
  onVersionChange,
  onSubmit,
  onConnectToLast,
}) => {
  const [fieldsCollapsed, setFieldsCollapsed] = useState(false)
  const [hasBootstrappedCollapse, setHasBootstrappedCollapse] = useState(false)

  useEffect(() => {
    if (hasBootstrappedCollapse) {
      return
    }

    if (lastConnection) {
      setFieldsCollapsed(true)
      setHasBootstrappedCollapse(true)
    } else {
      setFieldsCollapsed(false)
    }
  }, [lastConnection, hasBootstrappedCollapse])

  useEffect(() => {
    if (!lastConnection && hasBootstrappedCollapse) {
      setFieldsCollapsed(false)
    }
  }, [lastConnection, hasBootstrappedCollapse])

  const toggleFields = () => {
    setFieldsCollapsed((prev) => !prev)
  }

  const accountButtons = useMemo(
    () => [
      { key: 'offline' as AccountType, label: 'Offline' },
      { key: 'online' as AccountType, label: 'Online (Microsoft)' },
    ],
    []
  )

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 p-8 shadow-form backdrop-blur">
      <form onSubmit={onSubmit} className="grid gap-5">
        {lastConnection ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-purple-800/40 bg-purple-900/30 p-4">
            <button
              type="button"
              onClick={onConnectToLast}
              disabled={isConnecting}
              className="inline-flex items-center justify-center rounded-full bg-purple-600 px-4 py-2 text-sm
                font-semibold text-ink transition hover:bg-purple-500 focus-visible:outline
                focus-visible:outline-offset-2 focus-visible:outline-purple-200 disabled:cursor-not-allowed
                disabled:bg-purple-500/50 disabled:text-purple-900/80"
            >
              {isConnecting ? 'Connecting…' : 'Connect to Last Server'}
            </button>
            {lastConnectionSummary ? (
              <p className="text-xs text-purple-100/80">Last connection: {lastConnectionSummary}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 text-xs text-purple-200/60">
              <button
                type="button"
                onClick={toggleFields}
                className="rounded-full bg-purple-900/40 px-3 py-1 text-[0.7rem] font-medium uppercase
                  tracking-[0.2em] text-purple-100 transition hover:bg-purple-800/60 focus-visible:outline
                  focus-visible:outline-offset-2 focus-visible:outline-purple-200"
              >
                {fieldsCollapsed ? 'Show Connection Fields' : 'Hide Connection Fields'}
              </button>
            </div>
          </div>
        ) : null}
        {!fieldsCollapsed && (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="text-xs font-semibold uppercase tracking-[0.3em] text-purple-400/80">
              Account Type
            </legend>
            {accountButtons.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => onAccountTypeChange(key)}
                className={`rounded-full px-4 py-1 text-sm transition focus-visible:outline
                focus-visible:outline-offset-2 ${
                  accountType === key
                    ? 'bg-purple-500 text-ink focus-visible:outline-purple-200'
                    : `bg-purple-900/40 text-purple-100 hover:bg-purple-800/60
                      focus-visible:outline-purple-200/40`
                }`}
              >
                {label}
              </button>
            ))}
          </fieldset>
        )}

        {!fieldsCollapsed && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-purple-100">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400/80">
                Host
              </span>
              <input
                value={host}
                onChange={(event) => onHostChange(event.target.value)}
                placeholder="play.example.com"
                className="rounded-xl border border-purple-900/50 bg-input-surface px-3 py-2 text-base
                  text-purple-100 transition focus:border-purple-500 focus:outline-none focus:ring-2
                  focus:ring-purple-500/50"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-purple-100">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400/80">
                Port
              </span>
              <input
                value={port}
                onChange={(event) => onPortChange(event.target.value)}
                placeholder="25565"
                className="rounded-xl border border-purple-900/50 bg-input-surface px-3 py-2 text-base
                  text-purple-100 transition focus:border-purple-500 focus:outline-none focus:ring-2
                  focus:ring-purple-500/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-purple-100 sm:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400/80">
                Username
              </span>
              <input
                value={username}
                onChange={(event) => onUsernameChange(event.target.value)}
                placeholder={accountType === 'online' ? 'email@example.com' : 'BotDisplayName'}
                className="rounded-xl border border-purple-900/50 bg-input-surface px-3 py-2 text-base
                  text-purple-100 transition focus:border-purple-500 focus:outline-none focus:ring-2
                  focus:ring-purple-500/50"
                required
              />
            </label>
            {accountType === 'online' ? (
              <label className="flex flex-col gap-1 text-sm text-purple-100 sm:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400/80">
                  Microsoft Password (optional)
                </span>
                <input
                  type="password"
                  value={onlinePassword}
                  onChange={(event) => onOnlinePasswordChange(event.target.value)}
                  placeholder="Leave blank to use device login"
                  className="rounded-xl border border-purple-900/50 bg-input-surface px-3 py-2 text-base
                    text-purple-100 transition focus:border-purple-500 focus:outline-none focus:ring-2
                    focus:ring-purple-500/50"
                />
              </label>
            ) : null}
            {accountType === 'offline' ? (
              <label className="flex flex-col gap-1 text-sm text-purple-100 sm:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400/80">
                  Server Password (optional)
                </span>
                <input
                  type="password"
                  value={offlinePassword}
                  onChange={(event) => onOfflinePasswordChange(event.target.value)}
                  placeholder="Used for automatic /register and /login commands"
                  className="rounded-xl border border-purple-900/50 bg-input-surface px-3 py-2 text-base
                    text-purple-100 transition focus:border-purple-500 focus:outline-none focus:ring-2
                    focus:ring-purple-500/50"
                />
              </label>
            ) : null}
            <label className="flex flex-col gap-1 text-sm text-purple-100 sm:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400/80">
                Server Version
              </span>
              <select
                value={version}
                onChange={(event) => onVersionChange(event.target.value)}
                className="rounded-xl border border-purple-900/50 bg-input-surface px-3 py-2 text-base
                  text-purple-100 transition focus:border-purple-500 focus:outline-none focus:ring-2
                  focus:ring-purple-500/50"
              >
                <option value="auto">Auto (latest supported)</option>
                {availableVersions.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
              <span className="text-xs text-purple-200/70">
                Match this to the server version if you see protocol mismatch errors.
              </span>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex flex-col text-xs text-purple-200/70">
            <span>Status: {status?.stage ?? 'idle'}</span>
            {status?.message ? <span className="text-purple-100/80">{status.message}</span> : null}
            {lastError ? <span className="text-rose-300">Error: {lastError}</span> : null}
          </div>
          <button
            type="submit"
            disabled={isConnecting}
            className="rounded-full bg-purple-600 px-5 py-2 text-sm font-semibold text-ink transition
              hover:bg-purple-500 focus-visible:outline focus-visible:outline-offset-2
              focus-visible:outline-purple-300 disabled:cursor-not-allowed disabled:bg-purple-500/50
              disabled:text-purple-900"
          >
            {isConnecting ? 'Connecting…' : 'Connect & Start'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default ConnectionForm
