import React, { useEffect, useState } from 'react'
import { Check, Pencil, Server } from 'lucide-react'
import type { AccountType, BotStatus, LastConnection } from '../types'
import pkg from '../../package.json'
import ServerPreview from './ServerPreview'

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
    <div className="mx-auto flex w-full max-w-xl flex-col px-6 py-5">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
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

        <ServerPreview host={host} port={port} />

        <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/50 shadow-lg shadow-black/10">
          <div className="flex items-center justify-between gap-4 border-b border-neutral-800/80 px-5 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-700/60 bg-neutral-800/60 text-neutral-400">
                <Server size={17} aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-neutral-100">Connection Details</h3>
                <p className="mt-0.5 text-xs text-neutral-500">Your server and bot account.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleEditing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700/70 bg-neutral-800/60 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:border-neutral-600 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              {isEditing ? <Check size={13} aria-hidden="true" /> : <Pencil size={13} aria-hidden="true" />}
              {isEditing ? 'Done' : 'Edit'}
            </button>
          </div>

          {isEditing ? (
            <div className="grid gap-4 px-5 py-4">
              <fieldset className="min-w-0">
                <legend className="mb-2 text-xs font-medium text-neutral-400">Account type</legend>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['offline', 'Offline', 'Use a bot username'],
                    ['online', 'Microsoft', 'Sign in with your account'],
                  ] as const).map(([type, title, description]) => (
                    <label
                      key={type}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${
                        accountType === type
                          ? 'border-sky-500/40 bg-sky-500/5'
                          : 'border-neutral-800 bg-neutral-950/40 hover:border-neutral-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="account-type"
                        value={type}
                        checked={accountType === type}
                        onChange={() => onAccountTypeChange(type)}
                        className="h-3.5 w-3.5 shrink-0 accent-sky-500 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-neutral-200">{title}</span>
                        <span className="mt-0.5 block text-[11px] text-neutral-500">{description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
                <label className="flex min-w-0 flex-col gap-2 text-sm text-neutral-200">
                  <span className="text-xs font-medium text-neutral-400">
                    Host
                  </span>
                  <input
                    value={host}
                    onChange={(event) => onHostChange(event.target.value)}
                    placeholder="play.example.com"
                    className="w-full rounded-lg border border-neutral-700/60 bg-neutral-950/70 px-3 py-2 text-sm
                      text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                      focus:ring-sky-500/15"
                    required
                  />
                </label>

                <label className="flex min-w-0 flex-col gap-2 text-sm text-neutral-200">
                  <span className="text-xs font-medium text-neutral-400">
                    Port
                  </span>
                  <input
                    value={port}
                    onChange={(event) => onPortChange(event.target.value)}
                    placeholder="25565"
                    inputMode="numeric"
                    className="w-full rounded-lg border border-neutral-700/60 bg-neutral-950/70 px-3 py-2 text-sm
                      text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                      focus:ring-sky-500/15"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-2 text-sm text-neutral-200">
                <span className="text-xs font-medium text-neutral-400">
                  Username
                </span>
                <input
                  value={username}
                  onChange={(event) => onUsernameChange(event.target.value)}
                  placeholder={accountType === 'online' ? 'email@example.com' : 'BotDisplayName'}
                  className="w-full rounded-lg border border-neutral-700/60 bg-neutral-950/70 px-3 py-2 text-sm
                    text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                    focus:ring-sky-500/15"
                  required
                />
              </label>

              {accountType === 'online' ? (
                <label className="flex flex-col gap-2 text-sm text-neutral-200">
                  <span className="text-xs font-medium text-neutral-400">
                    Microsoft password (optional)
                  </span>
                  <input
                    type="password"
                    value={onlinePassword}
                    onChange={(event) => onOnlinePasswordChange(event.target.value)}
                    placeholder="Leave blank to use device login"
                    className="w-full rounded-lg border border-neutral-700/60 bg-neutral-950/70 px-3 py-2 text-sm
                      text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                      focus:ring-sky-500/15"
                  />
                </label>
              ) : null}

              {accountType === 'offline' ? (
                <div className="grid gap-3">
                  <label className="flex flex-col gap-2 text-sm text-neutral-200">
                    <span className="text-xs font-medium text-neutral-400">
                      Server password (optional)
                    </span>
                    <input
                      type="password"
                      value={offlinePassword}
                      onChange={(event) => onOfflinePasswordChange(event.target.value)}
                      placeholder="Server login password"
                      className="w-full rounded-lg border border-neutral-700/60 bg-neutral-950/70 px-3 py-2 text-sm
                        text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                        focus:ring-sky-500/15"
                    />
                    <span className="text-xs text-neutral-500">Used for automatic /register and /login commands.</span>
                  </label>
                  <div className="rounded-lg border border-neutral-800/70 bg-neutral-950/30 px-3 py-2.5">
                    <label className="flex cursor-pointer items-center gap-2.5 text-xs text-neutral-300">
                      <input
                        type="checkbox"
                        checked={preJoinLoginEnabled}
                        onChange={(event) => onPreJoinLoginToggle(event.target.checked)}
                        className="h-4 w-4 accent-sky-500"
                      />
                      Log in on the server's login screen
                    </label>
                    <p className="mt-1 pl-6.5 text-[11px] leading-relaxed text-neutral-500">
                      Enable for servers like AuthMe that require login before joining.
                    </p>
                  </div>
                </div>
              ) : null}

              <label className="flex flex-col gap-2 text-sm text-neutral-200">
                <span className="text-xs font-medium text-neutral-400">
                  Server version
                </span>
                <select
                  value={version}
                  onChange={(event) => onVersionChange(event.target.value)}
                  className="w-full rounded-lg border border-neutral-700/60 bg-neutral-950/70 px-3 py-2 text-sm
                    text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                    focus:ring-sky-500/15"
                >
                  <option value="auto">Auto (detect server version)</option>
                  {availableVersions.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-neutral-500">
                  Auto detects the version. Choose one only if the server needs it.
                </span>
              </label>
            </div>
          ) : (
            <dl className="grid gap-5 px-5 py-5 text-sm text-neutral-300">
              <div className="flex items-center justify-between gap-4">
                <dt className="shrink-0 text-xs text-neutral-500">Account</dt>
                <dd className="min-w-0 break-words text-right font-medium text-neutral-200">{accountLabel}</dd>
              </div>
              {/* The server card above shows the host and port once one is set. */}
              {host.trim() ? null : (
                <div className="flex items-center justify-between gap-4">
                  <dt className="shrink-0 text-xs text-neutral-500">Host</dt>
                  <dd className="min-w-0 break-words text-right font-medium text-neutral-200">Not set</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="shrink-0 text-xs text-neutral-500">Username</dt>
                <dd className="min-w-0 break-words text-right font-medium text-neutral-200">{username || 'Not set'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="shrink-0 text-xs text-neutral-500">Version</dt>
                <dd className="min-w-0 break-words text-right font-medium text-neutral-200">{versionLabel}</dd>
              </div>
              {accountType === 'offline' && preJoinLoginEnabled ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="shrink-0 text-xs text-neutral-500">Login Screen</dt>
                  <dd className="min-w-0 break-words text-right font-medium text-neutral-200">Auto login</dd>
                </div>
              ) : null}
              {onlinePassword ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="shrink-0 text-xs text-neutral-500">Microsoft Password</dt>
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
                  <dt className="shrink-0 text-xs text-neutral-500">Server Password</dt>
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
      <p className="mt-auto pt-6 text-center text-[11px] text-neutral-600">Ryksu v{pkg.version}</p>
    </div>
  )
}

export default ConnectionForm
