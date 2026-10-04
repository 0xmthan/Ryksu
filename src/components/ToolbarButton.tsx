import React from 'react'

const ToolbarButton: React.FC<{
  label: string
  description: string
  active: boolean
  onClick: () => void
  onConfigure?: () => void
  children: React.ReactNode
}> = ({ label, description, active, onClick, onConfigure, children }) => {
  const tooltipId = React.useId()
  return (
    <div className="group relative flex">
      <button
        type="button"
        onClick={onClick}
        onContextMenu={
          onConfigure
            ? (event) => {
                event.preventDefault()
                onConfigure()
              }
            : undefined
        }
        onKeyDown={
          onConfigure
            ? (event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault()
                  onConfigure()
                }
              }
            : undefined
        }
        aria-label={label}
        aria-pressed={active}
        aria-describedby={tooltipId}
        className={`flex h-8 w-8 items-center justify-center rounded-full border transition duration-150
          hover:border-sky-400/70 hover:bg-sky-500/20 hover:text-sky-100
          hover:shadow-[0_0_12px_rgba(56,189,248,0.15)] active:scale-95 focus-visible:outline
          focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
            active
              ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
              : 'border-neutral-700/60 bg-neutral-900/70 text-neutral-300'
          }`}
      >
        {children}
      </button>
      <div
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-52 translate-y-1 rounded-lg
          border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-left opacity-0 shadow-xl transition
          duration-150 group-hover:translate-y-0 group-hover:opacity-100
          group-has-[:focus-visible]:translate-y-0 group-has-[:focus-visible]:opacity-100"
      >
        <span
          className="absolute -top-1 right-3 h-2 w-2 rotate-45 border-l border-t border-neutral-700
            bg-neutral-900"
        />
        <span className="flex items-center justify-between gap-2 text-xs font-semibold text-neutral-100">
          {label}
          <span className={active ? 'text-sky-300' : 'text-neutral-500'}>{active ? 'On' : 'Off'}</span>
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-neutral-400">{description}</span>
      </div>
    </div>
  )
}

export default ToolbarButton
