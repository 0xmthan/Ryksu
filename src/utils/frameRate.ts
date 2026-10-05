// The 3D view's frame rate, measured where it draws and shown in the title bar.
import { useSyncExternalStore } from 'react'

let fps: number | null = null
const listeners = new Set<() => void>()

// null while no 3D view is open.
export const reportFps = (value: number | null) => {
  if (value === fps) return
  fps = value
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useFps = () => useSyncExternalStore(subscribe, () => fps)
