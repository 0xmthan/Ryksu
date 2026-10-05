import { useEffect, useState } from 'react'
import { Bug, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import pkg from '../../package.json'
import logo from '../../assets/icon.png'
import license from '../../LICENSE?raw'

type AppInfo = Awaited<ReturnType<Window['electronAPI']['getAppInfo']>>

export default function AboutPage() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copyInfo = async () => {
    try {
      const result = await window.electronAPI.copyAppInfo()
      setCopyState(result.ok ? 'copied' : 'failed')
    } catch {
      setCopyState('failed')
    }
  }

  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = setTimeout(() => setCopyState('idle'), 1500)
    return () => clearTimeout(timer)
  }, [copyState])

  const reportIssue = async () => {
    try {
      const result = await window.electronAPI.openExternal('https://github.com/0xmthan/Ryksu/issues/new')
      setActionMessage(result.ok ? '' : 'Could not open GitHub. Please try again.')
    } catch {
      setActionMessage('Could not open GitHub. Please try again.')
    }
  }

  const checkUpdates = async () => {
    if (isChecking) return
    setIsChecking(true)
    setUpdateMessage('')
    try {
      const result = await window.electronAPI.checkForUpdates()
      setUpdateMessage(
        result.status === 'available'
          ? `Version ${result.version} is available. GitHub Releases opened.`
          : result.status === 'current'
            ? 'You’re up to date.'
            : result.status === 'no-release'
              ? 'No published releases yet.'
              : (result.message ?? 'Could not check for updates. Please try again.')
      )
    } catch {
      setUpdateMessage('Could not check for updates. Please try again.')
    } finally {
      setIsChecking(false)
    }
  }

  const actionClass =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-300 transition hover:border-sky-400/70 hover:text-sky-200 focus-visible:outline-sky-400 disabled:cursor-wait disabled:opacity-50'

  useEffect(() => {
    let active = true
    window.electronAPI.getAppInfo().then(
      (value) => {
        if (active) setInfo(value)
      },
      () => {
        if (active) setError(true)
      }
    )
    return () => {
      active = false
    }
  }, [])

  return (
    <section className="mx-auto w-full max-w-xl px-6 py-8 text-neutral-200" aria-labelledby="about-heading">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-6">
        <div className="flex items-center gap-4">
          <img src={logo} alt="" className="h-14 w-14" />
          <div>
            <h1 id="about-heading" className="text-2xl font-bold uppercase tracking-tight text-neutral-100">
              Ryksu
            </h1>
            <p className="mt-1 text-sm text-neutral-400">
              {info ? `Version ${info.version}` : error ? 'Version unavailable' : 'Loading version…'}
            </p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-neutral-400">{pkg.description}</p>
        <dl className="mt-6 space-y-3 border-t border-neutral-800 pt-5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">Created by</dt>
            <dd>{pkg.author.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">Contact</dt>
            <dd className="select-text">{pkg.author.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">License</dt>
            <dd>{pkg.license}</dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={reportIssue} className={actionClass}>
            <Bug size={14} aria-hidden="true" />
            Report an issue
          </button>
          <button type="button" onClick={checkUpdates} disabled={isChecking} className={actionClass}>
            <RefreshCw size={14} aria-hidden="true" className={isChecking ? 'animate-spin' : ''} />
            {isChecking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
        <div role="status" aria-live="polite" className="text-xs leading-relaxed text-neutral-400">
          {actionMessage && <p className="mt-3">{actionMessage}</p>}
          {updateMessage && <p className="mt-3">{updateMessage}</p>}
        </div>
        <button
          type="button"
          onClick={() => window.electronAPI.openExternal('https://github.com/0xmthan/Ryksu')}
          className="mt-5 inline-flex items-center gap-2 text-sm text-sky-300 hover:text-sky-200
            focus-visible:outline-sky-400"
        >
          View on GitHub <ExternalLink size={14} aria-hidden="true" />
        </button>
        <details className="mt-6 border-t border-neutral-800 pt-5">
          <summary className="cursor-pointer text-sm font-medium text-neutral-300">MIT license</summary>
          <pre
            className="mt-4 whitespace-pre-wrap wrap-break-word font-sans text-xs leading-relaxed
              text-neutral-400"
          >
            {license}
          </pre>
        </details>
      </div>
      <section
        className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950/70 p-6"
        aria-labelledby="system-heading"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="system-heading" className="text-sm font-medium text-neutral-300">
            System details
          </h2>
          <button
            type="button"
            onClick={copyInfo}
            aria-label="Copy app info"
            title={copyState === 'copied' ? 'Copied' : 'Copy app info'}
            className="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-800 hover:text-sky-200
              focus-visible:outline-sky-400"
          >
            {copyState === 'copied' ? (
              <Check size={14} aria-hidden="true" className="text-emerald-400" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
          </button>
        </div>
        {info ? (
          <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs text-neutral-400">
            <dt>Platform</dt>
            <dd className="text-right">
              {info.platform} / {info.arch}
            </dd>
            <dt>Electron</dt>
            <dd className="text-right">{info.electron}</dd>
            <dt>Chromium</dt>
            <dd className="text-right">{info.chromium}</dd>
            <dt>Node.js</dt>
            <dd className="text-right">{info.node}</dd>
          </dl>
        ) : (
          <p className="mt-4 text-xs text-neutral-400" role="status">
            {error ? 'System details unavailable.' : 'Loading system details…'}
          </p>
        )}
        <div role="status" aria-live="polite" className="text-xs text-neutral-400">
          {copyState === 'copied' && <span className="sr-only">App info copied.</span>}
          {copyState === 'failed' && <p className="mt-3">Could not copy app info. Please try again.</p>}
        </div>
      </section>
    </section>
  )
}
