import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutoEatOptions, PathfinderOptions, PvpOptions } from '../../../shared/types'
import { AUTO_EAT_DEFAULTS, loadPluginPreferences, savePluginPreferences } from './plugins'

const usePluginControls = () => {
  const [armorManagerEnabled, setArmorManagerEnabled] = useState(false)
  const [autoEatEnabled, setAutoEatEnabled] = useState(false)
  const [autoEatOptions, setAutoEatOptions] = useState<AutoEatOptions>(AUTO_EAT_DEFAULTS)
  const [autoToolEnabled, setAutoToolEnabled] = useState(false)
  const [autoShieldEnabled, setAutoShieldEnabled] = useState(false)
  const [pathfinder, setPathfinder] = useState<PathfinderOptions>({ followEnabled: false, followTarget: '' })
  const [pvpOptions, setPvpOptions] = useState<PvpOptions>({
    mobEnabled: false,
    playerEnabled: false,
    playerTarget: '',
    mobMovementEnabled: true,
    allowBlockBreak: true,
    jumpAttackEnabled: true,
  })
  const stateRef = useRef({
    armorManagerEnabled,
    autoEatEnabled,
    autoEatOptions,
    autoToolEnabled,
    autoShieldEnabled,
    pathfinder,
    pvp: pvpOptions,
  })

  const pushPreferences = useCallback(
    async ({
      armorManagerEnabled: mgrEnabled,
      autoEatEnabled: eatEnabled,
      autoEatOptions: eatOptions,
      autoToolEnabled: toolEnabled,
      autoShieldEnabled: shieldEnabled,
      pathfinder: pathfinderOptions,
      pvp,
    }: {
      armorManagerEnabled: boolean
      autoEatEnabled: boolean
      autoEatOptions: AutoEatOptions
      autoToolEnabled: boolean
      autoShieldEnabled: boolean
      pathfinder: PathfinderOptions
      pvp: PvpOptions
    }) => {
      try {
        await window.electronAPI.bot.setArmorManagerEnabled(mgrEnabled)
      } catch (error) {
        console.error('Failed to apply armor manager preference', error)
      }

      try {
        await window.electronAPI.bot.setAutoEatEnabled(eatEnabled)
      } catch (error) {
        console.error('Failed to apply auto eat enabled preference', error)
      }

      try {
        await window.electronAPI.bot.setAutoEatOptions(eatOptions)
      } catch (error) {
        console.error('Failed to apply auto eat options preference', error)
      }

      try {
        await window.electronAPI.bot.setAutoToolEnabled(toolEnabled)
      } catch (error) {
        console.error('Failed to apply auto tool preference', error)
      }

      try {
        await window.electronAPI.bot.setAutoShieldEnabled(shieldEnabled)
      } catch (error) {
        console.error('Failed to apply auto shield preference', error)
      }

      try {
        await window.electronAPI.bot.setPathfinderOptions(pathfinderOptions)
      } catch (error) {
        console.error('Failed to apply pathfinder preferences', error)
      }

      try {
        await window.electronAPI.bot.setPvpOptions(pvp)
      } catch (error) {
        console.error('Failed to apply pvp preference', error)
      }
    },
    []
  )

  useEffect(() => {
    const preferences = loadPluginPreferences()
    setArmorManagerEnabled(preferences.armorManagerEnabled)
    setAutoEatEnabled(preferences.autoEatEnabled)
    setAutoEatOptions(preferences.autoEatOptions)
    setAutoToolEnabled(preferences.autoToolEnabled)
    setAutoShieldEnabled(preferences.autoShieldEnabled)
    setPathfinder(preferences.pathfinder)
    setPvpOptions(preferences.pvp)
    pushPreferences(preferences)
  }, [pushPreferences])

  useEffect(() => {
    stateRef.current = {
      armorManagerEnabled,
      autoEatEnabled,
      autoEatOptions,
      autoToolEnabled,
      autoShieldEnabled,
      pathfinder,
      pvp: pvpOptions,
    }
  }, [
    armorManagerEnabled,
    autoEatEnabled,
    autoEatOptions,
    autoToolEnabled,
    autoShieldEnabled,
    pathfinder,
    pvpOptions,
  ])

  useEffect(() => {
    const unsubscribe = window.electronAPI.bot.onStatus((incoming) => {
      if (incoming?.stage === 'connected') {
        pushPreferences(stateRef.current)
      }
    })

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [pushPreferences])

  const persist = useCallback(
    (
      next: Partial<{
        armorManagerEnabled: boolean
        autoEatEnabled: boolean
        autoEatOptions: AutoEatOptions
        autoToolEnabled: boolean
        autoShieldEnabled: boolean
        pathfinder: PathfinderOptions
        pvp: PvpOptions
      }>
    ) => {
      savePluginPreferences({
        armorManagerEnabled: next.armorManagerEnabled ?? armorManagerEnabled,
        autoEatEnabled: next.autoEatEnabled ?? autoEatEnabled,
        autoEatOptions: next.autoEatOptions ?? autoEatOptions,
        autoToolEnabled: next.autoToolEnabled ?? autoToolEnabled,
        autoShieldEnabled: next.autoShieldEnabled ?? autoShieldEnabled,
        pathfinder: next.pathfinder ?? pathfinder,
        pvp: next.pvp ?? pvpOptions,
      })
    },
    [
      armorManagerEnabled,
      autoEatEnabled,
      autoEatOptions,
      autoToolEnabled,
      autoShieldEnabled,
      pathfinder,
      pvpOptions,
    ]
  )

  const toggleArmorManager = useCallback(
    async (nextValue: boolean) => {
      const previousValue = armorManagerEnabled
      setArmorManagerEnabled(nextValue)
      try {
        await window.electronAPI.bot.setArmorManagerEnabled(nextValue)
        persist({ armorManagerEnabled: nextValue })
      } catch (error) {
        console.error('Failed to update armor manager preference', error)
        setArmorManagerEnabled(previousValue)
      }
    },
    [armorManagerEnabled, persist]
  )

  const toggleAutoEat = useCallback(
    async (nextValue: boolean) => {
      const previousValue = autoEatEnabled
      setAutoEatEnabled(nextValue)
      try {
        await window.electronAPI.bot.setAutoEatEnabled(nextValue)
        persist({ autoEatEnabled: nextValue })
      } catch (error) {
        console.error('Failed to update auto eat preference', error)
        setAutoEatEnabled(previousValue)
      }
    },
    [autoEatEnabled, persist]
  )

  const toggleAutoTool = useCallback(
    async (nextValue: boolean) => {
      const previousValue = autoToolEnabled
      setAutoToolEnabled(nextValue)
      try {
        await window.electronAPI.bot.setAutoToolEnabled(nextValue)
        persist({ autoToolEnabled: nextValue })
      } catch (error) {
        console.error('Failed to update auto tool preference', error)
        setAutoToolEnabled(previousValue)
      }
    },
    [autoToolEnabled, persist]
  )

  const toggleAutoShield = useCallback(
    async (nextValue: boolean) => {
      const previousValue = autoShieldEnabled
      setAutoShieldEnabled(nextValue)
      try {
        await window.electronAPI.bot.setAutoShieldEnabled(nextValue)
        persist({ autoShieldEnabled: nextValue })
      } catch (error) {
        console.error('Failed to update auto shield preference', error)
        setAutoShieldEnabled(previousValue)
      }
    },
    [autoShieldEnabled, persist]
  )

  const updateAutoEatOptions = useCallback(
    async (nextOptions: AutoEatOptions) => {
      try {
        const response = await window.electronAPI.bot.setAutoEatOptions(nextOptions)
        const resolvedOptions = response?.options ?? nextOptions
        setAutoEatOptions(resolvedOptions)
        persist({ autoEatOptions: resolvedOptions })
        return resolvedOptions
      } catch (error) {
        console.error('Failed to update auto eat options', error)
        return null
      }
    },
    [persist]
  )

  // The bot can change follow itself (in-game gesture), so mirror its state here.
  useEffect(
    () =>
      window.electronAPI.bot.onPathfinderOptions((options) => {
        setPathfinder(options)
        persist({ pathfinder: options })
      }),
    [persist]
  )

  const updatePathfinder = useCallback(
    async (next: PathfinderOptions) => {
      const previous = pathfinder
      setPathfinder(next)
      try {
        const response = await window.electronAPI.bot.setPathfinderOptions(next)
        if (response?.options) {
          setPathfinder(response.options)
          persist({ pathfinder: response.options })
        } else {
          persist({ pathfinder: next })
        }
      } catch (error) {
        console.error('Failed to update pathfinder options', error)
        setPathfinder(previous)
      }
    },
    [pathfinder, persist]
  )

  const updatePvpOptions = useCallback(
    async (next: Partial<PvpOptions>) => {
      const merged: PvpOptions = {
        mobEnabled: next.mobEnabled ?? pvpOptions.mobEnabled,
        playerEnabled: next.playerEnabled ?? pvpOptions.playerEnabled,
        playerTarget:
          typeof next.playerTarget === 'string' ? next.playerTarget.trim() : pvpOptions.playerTarget,
        mobMovementEnabled: next.mobMovementEnabled ?? pvpOptions.mobMovementEnabled,
        allowBlockBreak: next.allowBlockBreak ?? pvpOptions.allowBlockBreak,
        jumpAttackEnabled: next.jumpAttackEnabled ?? pvpOptions.jumpAttackEnabled,
      }

      setPvpOptions(merged)
      try {
        await window.electronAPI.bot.setPvpOptions(merged)
        persist({ pvp: merged })
      } catch (error) {
        console.error('Failed to update pvp options', error)
        setPvpOptions(pvpOptions)
      }
    },
    [persist, pvpOptions]
  )

  const togglePvp = useCallback(
    async (enabled: boolean) => {
      await updatePvpOptions({ mobEnabled: enabled })
    },
    [updatePvpOptions]
  )

  const togglePvpPlayer = useCallback(
    async (enabled: boolean) => {
      await updatePvpOptions({ playerEnabled: enabled })
    },
    [updatePvpOptions]
  )

  const updatePvpPlayerTarget = useCallback(
    async (target: string) => {
      await updatePvpOptions({ playerTarget: target })
    },
    [updatePvpOptions]
  )

  return {
    armorManagerEnabled,
    autoEatEnabled,
    autoEatOptions,
    toggleArmorManager,
    toggleAutoEat,
    autoToolEnabled,
    toggleAutoTool,
    autoShieldEnabled,
    toggleAutoShield,
    updateAutoEatOptions,
    pathfinder,
    updatePathfinder,
    pvpEnabled: pvpOptions.mobEnabled,
    togglePvp,
    pvpPlayerEnabled: pvpOptions.playerEnabled,
    pvpPlayerTarget: pvpOptions.playerTarget,
    togglePvpPlayer,
    updatePvpPlayerTarget,
    pvpOptions,
    updatePvpOptions,
  }
}

export default usePluginControls
