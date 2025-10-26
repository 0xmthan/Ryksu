import React from 'react'

const TitleBar: React.FC = () => {
  const handleMinimize = () => {
    window.electronAPI?.minimize()
  }

  const handleClose = () => {
    window.electronAPI?.close()
  }

  return (
    <header
      className="app-region-drag flex h-11 items-center justify-between border-b border-purple-900/40
        bg-titlebar px-4 backdrop-blur"
    >
      <div
        className="flex items-center gap-2 text-[0.65rem] font-medium uppercase tracking-[0.4em]
          text-purple-300"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-purple-400 shadow-indicator" />
        <span>Ryksu</span>
      </div>
      <div className="app-region-no-drag flex items-center gap-2">
        <button
          type="button"
          onClick={handleMinimize}
          className="group relative flex h-8 w-8 items-center justify-center rounded-full border
            border-purple-800/60 bg-purple-900/50 text-purple-200 transition hover:border-purple-400
            hover:bg-purple-500/20 hover:text-purple-100 focus-visible:outline focus-visible:outline-offset-2
            focus-visible:outline-purple-300"
          aria-label="Minimize window"
        >
          <span className="sr-only">Minimize</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 14 14"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M3 7h8" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="group relative flex h-8 w-8 items-center justify-center rounded-full border
            border-purple-800/60 bg-purple-900/50 text-purple-200 transition hover:border-rose-500/60
            hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline focus-visible:outline-offset-2
            focus-visible:outline-rose-400"
          aria-label="Close window"
        >
          <span className="sr-only">Close</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 14 14"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M4 4l6 6M10 4L4 10" />
          </svg>
        </button>
      </div>
    </header>
  )
}

export default TitleBar
