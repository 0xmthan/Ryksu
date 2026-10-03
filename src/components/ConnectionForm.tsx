import React, { useEffect, useState } from 'react'
import type { AccountType, BotStatus, LastConnection } from '../types'

type ConnectionFormProps = {
  status: BotStatus
  accountType: AccountType
  host: string
  port: string
  username: string
  onlinePassword: string
  offlinePassword: string
  preJoinLoginEnabled: boolean
  version: string
  availableVersions: string[]
  lastConnection: LastConnection | null
  onAccountTypeChange: (type: AccountType) => void
  onHostChange: (value: string) => void
  onPortChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onOnlinePasswordChange: (value: string) => void
  onOfflinePasswordChange: (value: string) => void
  onPreJoinLoginToggle: (enabled: boolean) => void
  onVersionChange: (value: string) => void
  onSubmit: React.FormEventHandler<HTMLFormElement>
  onCommitEdit: () => void
}

const ConnectionForm: React.FC<ConnectionFormProps> = ({
  status,
  accountType,
  host,
  port,
  username,
  onlinePassword,
  offlinePassword,
  preJoinLoginEnabled,
  version,
  availableVersions,
  lastConnection,
  onAccountTypeChange,
  onHostChange,
  onPortChange,
  onUsernameChange,
  onOnlinePasswordChange,
  onOfflinePasswordChange,
  onPreJoinLoginToggle,
  onVersionChange,
  onSubmit,
  onCommitEdit,
}) => {
  const [isEditing, setIsEditing] = useState(!lastConnection)
  const [showOnlinePassword, setShowOnlinePassword] = useState(false)
  const [showOfflinePassword, setShowOfflinePassword] = useState(false)
  const hasBootstrappedView = React.useRef(false)

  useEffect(() => {
    if (hasBootstrappedView.current) {
      return
    }

    if (lastConnection) {
      setIsEditing(false)
      hasBootstrappedView.current = true
    }
  }, [lastConnection])

  const hasRequiredFields = Boolean(host.trim() && username.trim())
  const accountLabel = accountType === 'online' ? 'Online (Microsoft)' : 'Offline'
  const versionLabel = version === 'auto' ? 'Auto (detect server version)' : version || 'Not set'
  const microsoftAuth = status?.stage === 'auth-required' ? status.microsoftAuth : undefined

  const handleOpenMicrosoftLink = async (url: string) => {
    try {
      await window.electronAPI.openExternal(url)
    } catch (error) {
      console.error('Failed to open external URL', error)
    }
  }

  const handleToggleEditing = () => {
    if (isEditing) {
      onCommitEdit()
      setIsEditing(false)
      setShowOnlinePassword(false)
      setShowOfflinePassword(false)
    } else {
      setIsEditing(true)
    }
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 px-8 py-8">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-6 rounded-2xl border border-neutral-800 bg-neutral-950/70 p-6 shadow-md"
      >
        {microsoftAuth ? (
          <section className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-50">
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/80">
                  Microsoft Sign-In
                </p>
                <p className="mt-2 text-sm text-sky-50">
                  Click the link below, then enter code{' '}
                  <span className="rounded bg-sky-950/60 px-2 py-1 font-mono tracking-[0.2em]">
                    {microsoftAuth.userCode}
                  </span>
                  .
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    handleOpenMicrosoftLink(
                      microsoftAuth.directVerificationUri || microsoftAuth.verificationUri
                    )
                  }
                  className="rounded-full border border-sky-300/40 bg-sky-300/15 px-4 py-2 text-xs
                    font-semibold uppercase tracking-[0.18em] text-sky-50 transition
                    hover:bg-sky-300/25 focus-visible:outline focus-visible:outline-offset-2
                    focus-visible:outline-sky-300"
                >
                  Open Microsoft Login
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenMicrosoftLink(microsoftAuth.verificationUri)}
                  className="text-xs font-medium text-sky-100/80 underline decoration-sky-300/50
                    underline-offset-4 transition hover:text-sky-50"
                >
                  {microsoftAuth.verificationUri}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <h3 className="text-sm font-medium text-neutral-200">Connection Details</h3>
            <button
              type="button"
              onClick={handleToggleEditing}
              className="text-xs font-medium text-sky-400 transition hover:text-sky-300 focus-visible:outline
                focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              {isEditing ? 'Done' : 'Edit'}
            </button>
          </div>

          {isEditing ? (
            <div className="grid gap-4 px-4 py-4">
              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                  Account Type
                </legend>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-neutral-200">
                    <input
                      type="radio"
                      name="account-type"
                      value="offline"
                      checked={accountType === 'offline'}
                      onChange={() => onAccountTypeChange('offline')}
                      className="h-4 w-4 accent-sky-500"
                    />
                    Offline
                  </label>
                  <label className="flex items-center gap-2 text-sm text-neutral-200">
                    <input
                      type="radio"
                      name="account-type"
                      value="online"
                      checked={accountType === 'online'}
                      onChange={() => onAccountTypeChange('online')}
                      className="h-4 w-4 accent-sky-500"
                    />
                    Online (Microsoft)
                  </label>
                </div>
              </fieldset>

              <label className="flex flex-col gap-2 text-sm text-neutral-200">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                  Host
                </span>
                <input
                  value={host}
                  onChange={(event) => onHostChange(event.target.value)}
                  placeholder="play.example.com"
                  className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                    text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                    focus:ring-sky-500/40"
                  required
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-neutral-200">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                  Port
                </span>
                <input
                  value={port}
                  onChange={(event) => onPortChange(event.target.value)}
                  placeholder="25565"
                  className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                    text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                    focus:ring-sky-500/40"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-neutral-200">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                  Username
                </span>
                <input
                  value={username}
                  onChange={(event) => onUsernameChange(event.target.value)}
                  placeholder={accountType === 'online' ? 'email@example.com' : 'BotDisplayName'}
                  className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                    text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                    focus:ring-sky-500/40"
                  required
                />
              </label>

              {accountType === 'online' ? (
                <label className="flex flex-col gap-2 text-sm text-neutral-200">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                    Microsoft Password (optional)
                  </span>
                  <input
                    type="password"
                    value={onlinePassword}
                    onChange={(event) => onOnlinePasswordChange(event.target.value)}
                    placeholder="Leave blank to use device login"
                    className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                      text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                      focus:ring-sky-500/40"
                  />
                </label>
              ) : null}

              {accountType === 'offline' ? (
                <label className="flex flex-col gap-2 text-sm text-neutral-200">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                    Server Password (optional)
                  </span>
                  <input
                    type="password"
                    value={offlinePassword}
                    onChange={(event) => onOfflinePasswordChange(event.target.value)}
                    placeholder="Used for automatic /register and /login commands"
                    className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                      text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                      focus:ring-sky-500/40"
                  />
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={preJoinLoginEnabled}
                      onChange={(event) => onPreJoinLoginToggle(event.target.checked)}
                      className="h-4 w-4 accent-sky-500"
                    />
                    Log in on the server's login screen
                  </span>
                  <span className="text-xs text-neutral-500">
                    For servers (like AuthMe) that show a login screen before you join.
                  </span>
                </label>
              ) : null}

              <label className="flex flex-col gap-2 text-sm text-neutral-200">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                  Server Version
                </span>
                <select
                  value={version}
                  onChange={(event) => onVersionChange(event.target.value)}
                  className="rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm
                    text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                    focus:ring-sky-500/40"
                >
                  <option value="auto">Auto (detect server version)</option>
                  {availableVersions.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-neutral-500">
                  Match this to the server version if protocol mismatch errors appear.
                </span>
              </label>
            </div>
          ) : (
            <dl className="grid gap-4 px-4 py-4 text-sm text-neutral-300">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-xs uppercase tracking-[0.2em] text-neutral-500">Account</dt>
                <dd className="font-medium text-neutral-100">{accountLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-xs uppercase tracking-[0.2em] text-neutral-500">Host</dt>
                <dd className="font-medium text-neutral-100">{host || 'Not set'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-xs uppercase tracking-[0.2em] text-neutral-500">Port</dt>
                <dd className="font-medium text-neutral-100">{port || 'Default'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-xs uppercase tracking-[0.2em] text-neutral-500">Username</dt>
                <dd className="font-medium text-neutral-100">{username || 'Not set'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-xs uppercase tracking-[0.2em] text-neutral-500">Version</dt>
                <dd className="font-medium text-neutral-100">{versionLabel}</dd>
              </div>
              {accountType === 'offline' && preJoinLoginEnabled ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-xs uppercase tracking-[0.2em] text-neutral-500">Login Screen</dt>
                  <dd className="font-medium text-neutral-100">Auto login</dd>
                </div>
              ) : null}
              {onlinePassword ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-xs uppercase tracking-[0.2em] text-neutral-500">Microsoft Password</dt>
                  <dd>
                    <button
                      type="button"
                      onClick={() => setShowOnlinePassword((prev) => !prev)}
                      className="flex items-center gap-2 rounded-md border border-neutral-700
                        bg-neutral-800/70 px-2 py-1 text-xs text-neutral-200 transition
                        hover:border-neutral-500 focus-visible:outline focus-visible:outline-offset-2
                        focus-visible:outline-sky-400"
                    >
                      <span
                        className={`font-mono tracking-wide ${
                          showOnlinePassword ? 'blur-0' : 'blur-sm select-none'
                        }`}
                      >
                        {onlinePassword}
                      </span>
                      <span className="text-neutral-400">{showOnlinePassword ? 'Hide' : 'Show'}</span>
                    </button>
                  </dd>
                </div>
              ) : null}
              {offlinePassword ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-xs uppercase tracking-[0.2em] text-neutral-500">Server Password</dt>
                  <dd>
                    <button
                      type="button"
                      onClick={() => setShowOfflinePassword((prev) => !prev)}
                      className="flex items-center gap-2 rounded-md border border-neutral-700
                        bg-neutral-800/70 px-2 py-1 text-xs text-neutral-200 transition
                        hover:border-neutral-500 focus-visible:outline focus-visible:outline-offset-2
                        focus-visible:outline-sky-400"
                    >
                      <span
                        className={`font-mono tracking-wide ${
                          showOfflinePassword ? 'blur-0' : 'blur-sm select-none'
                        }`}
                      >
                        {offlinePassword}
                      </span>
                      <span className="text-neutral-400">{showOfflinePassword ? 'Hide' : 'Show'}</span>
                    </button>
                  </dd>
                </div>
              ) : null}
            </dl>
          )}
        </section>
      </form>
    </div>
  )
}

export default ConnectionForm
