import React from 'react'
import { ScrollText } from 'lucide-react'
import type { ScriptLogEntry } from '../../../shared/types'
import { ScriptLogList, TurnOffButton } from './ScriptControls'

type ScriptSidePanelProps = {
  name: string
  status: string
  log: ScriptLogEntry[]
}

// Over the game view's left side while a script is on: the script, a way to turn it off, and its log.
const ScriptSidePanel: React.FC<ScriptSidePanelProps> = ({ name, status, log }) => (
  <section
    aria-label={`Script: ${name}`}
    className="flex min-h-0 flex-col gap-2 rounded-xl border border-white/10 bg-neutral-950/55 p-3 text-xs
      text-neutral-300 shadow-lg backdrop-blur-xl"
  >
    <header className="flex items-center gap-2">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-400/15
          text-emerald-300"
      >
        <ScrollText aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-emerald-100">{name}</p>
        <p role="status" className="truncate text-[0.68rem] text-neutral-400">
          {status}
        </p>
      </div>
    </header>
    <TurnOffButton status={status} className="py-1 text-xs" />
    <p className="text-[0.68rem] text-neutral-500">Automatic features are paused.</p>
    <ScriptLogList log={log} className="border-t border-white/10 pt-2 text-[0.68rem]" />
  </section>
)

export default ScriptSidePanel
