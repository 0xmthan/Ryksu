import { useEffect, useState } from 'react'
import type { ScriptsState } from '../../../shared/types'

const EMPTY: ScriptsState = { scripts: [], running: null, log: [] }

// The user's scripts, which one is on and their log, kept current from the main process.
export const useScripts = () => {
  const [state, setState] = useState<ScriptsState>(EMPTY)

  useEffect(() => {
    let current = true
    window.electronAPI.scripts.getState().then(
      (initial) => {
        if (current) setState(initial)
      },
      () => {}
    )
    const unsubscribe = window.electronAPI.scripts.onState(setState)
    return () => {
      current = false
      unsubscribe()
    }
  }, [])

  return state
}
