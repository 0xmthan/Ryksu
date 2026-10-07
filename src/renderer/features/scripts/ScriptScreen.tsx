import React from 'react'
import { ScrollText } from 'lucide-react'
import type { ScriptLogEntry } from '../../../shared/types'
import { ScriptLogList, TurnOffButton } from './ScriptControls'

type ScriptScreenProps = {
  name: string
  status: string
  log: ScriptLogEntry[]
}

// Stands in for the game view while a script has hidden the world (ryksu.hideWorld(), nothing 3D is drawn):
// the script, a way to turn it off, and its log.
const ScriptScreen: React.FC<ScriptScreenProps> = ({ name, status, log }) => (
  <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center gap-6 bg-neutral-950 px-6 pb-6 pt-16">
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/10
        text-emerald-300">
        <ScrollText aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <h1 className="text-xl font-semibold text-neutral-100">{name}</h1>
      <p role="status" className="text-sm text-emerald-300">
        {status}
      </p>
      <TurnOffButton status={status} className="mt-2 px-4 py-1.5 text-sm" />
      <p className="text-xs text-neutral-600">The world isn&apos;t drawn until the script turns off.</p>
    </div>

    <section
      className="flex min-h-0 w-full max-w-3xl flex-1 flex-col rounded-xl border border-neutral-800
        bg-neutral-900"
    >
      <h2 className="border-b border-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-400">Log</h2>
      <ScriptLogList log={log} className="px-4 py-2 text-xs" />
    </section>
  </div>
)

export default ScriptScreen
