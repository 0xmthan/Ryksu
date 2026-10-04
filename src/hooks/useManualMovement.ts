import { useEffect, useRef } from 'react'

const KEYS = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  AltLeft: 'sprint',
  AltRight: 'sprint',
  ShiftLeft: 'sneak',
  ShiftRight: 'sneak',
} as const

export default function useManualMovement(enabled: boolean, getYaw: () => number, onStart: () => void) {
  const yawRef = useRef(getYaw)
  yawRef.current = getYaw
  const startRef = useRef(onStart)
  startRef.current = onStart

  useEffect(() => {
    if (!enabled) return
    const pressed = new Set<string>()
    const blocked = () =>
      document.hidden ||
      Boolean(document.querySelector('[role="dialog"]')) ||
      Boolean(document.activeElement?.closest('input, textarea, select, [contenteditable="true"]'))
    const send = () => {
      const input = {
        forward: false,
        back: false,
        left: false,
        right: false,
        jump: false,
        sprint: false,
        sneak: false,
        yaw: yawRef.current(),
      }
      for (const key of pressed) input[KEYS[key as keyof typeof KEYS]] = true
      void window.electronAPI.bot.setMovementControls(input).catch(() => {})
    }
    const release = () => {
      if (!pressed.size) return
      pressed.clear()
      send()
    }
    const down = (event: KeyboardEvent) => {
      if (!(event.code in KEYS)) return
      if (blocked() || event.metaKey || event.ctrlKey) {
        release()
        return
      }
      event.preventDefault()
      if (pressed.has(event.code)) return
      if (!pressed.size) startRef.current()
      pressed.add(event.code)
      send()
    }
    const up = (event: KeyboardEvent) => {
      if (!pressed.delete(event.code)) return
      event.preventDefault()
      send()
    }
    const checkFocus = () => {
      if (blocked()) release()
    }
    const heartbeat = setInterval(() => {
      if (blocked()) release()
      else if (pressed.size) send()
    }, 100)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', release)
    document.addEventListener('focusin', checkFocus)
    return () => {
      release()
      clearInterval(heartbeat)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', release)
      document.removeEventListener('focusin', checkFocus)
    }
  }, [enabled])
}
