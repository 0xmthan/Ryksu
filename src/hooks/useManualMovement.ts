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

// Double-tapping W within this long sprints until W is let go, like the game.
const SPRINT_TAP_MS = 300

// `relative` (first person): the bot keeps facing `yaw`/`pitch` and A/D strafe, like the game. Otherwise
// the keys are turned into a heading around the camera and the bot faces where it walks.
export type MovementLook = { yaw: number; pitch?: number; relative?: boolean }

export default function useManualMovement(
  enabled: boolean,
  getLook: () => MovementLook,
  onStart: () => void
) {
  const lookRef = useRef(getLook)
  lookRef.current = getLook
  const startRef = useRef(onStart)
  startRef.current = onStart

  useEffect(() => {
    if (!enabled) return
    const pressed = new Set<string>()
    let lastForwardRelease = 0
    let tapSprint = false
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
        ...lookRef.current(),
      }
      for (const key of pressed) input[KEYS[key as keyof typeof KEYS]] = true
      if (tapSprint) input.sprint = true
      void window.electronAPI.bot.setMovementControls(input).catch(() => {})
    }
    const release = () => {
      tapSprint = false
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
      if (event.code === 'KeyW' && performance.now() - lastForwardRelease < SPRINT_TAP_MS) tapSprint = true
      pressed.add(event.code)
      send()
    }
    const up = (event: KeyboardEvent) => {
      if (!pressed.delete(event.code)) return
      if (event.code === 'KeyW') {
        lastForwardRelease = performance.now()
        tapSprint = false
      }
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
