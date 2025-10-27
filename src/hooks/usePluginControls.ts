import { useCallback, useEffect, useState } from 'react'
import type { AutoEatOptions, PathfinderOptions } from '../types'
import { AUTO_EAT_DEFAULTS, loadPluginPreferences, savePluginPreferences } from '../utils/plugins'

const usePluginControls = () => {
  const [armorManagerEnabled, setArmorManagerEnabled] = useState(false)
  const [autoEatEnabled, setAutoEatEnabled] = useState(false)
  const [autoEatOptions, setAutoEatOptions] = useState<AutoEatOptions>(AUTO_EAT_DEFAULTS)
  const [pathfinder, setPathfinder] = useState<PathfinderOptions>({ followEnabled: false, followTarget: '' })

  useEffect(() => {
    const preferences = loadPluginPreferences()
    setArmorManagerEnabled(preferences.armorManagerEnabled)
    setAutoEatEnabled(preferences.autoEatEnabled)
    setAutoEatOptions(preferences.autoEatOptions)
    setPathfinder(preferences.pathfinder)

    const applyPreferences = async () => {
      try {
        await window.electronAPI.bot.setArmorManagerEnabled(preferences.armorManagerEnabled)
      } catch (error) {
        console.error('Failed to apply armor manager preference', error)
      }

      try {
        await window.electronAPI.bot.setAutoEatEnabled(preferences.autoEatEnabled)
      } catch (error) {
        console.error('Failed to apply auto eat enabled preference', error)
      }

      try {
        await window.electronAPI.bot.setAutoEatOptions(preferences.autoEatOptions)
      } catch (error) {
        console.error('Failed to apply auto eat options preference', error)
      }

      try {
        await window.electronAPI.bot.setPathfinderOptions(preferences.pathfinder)
      } catch (error) {
        console.error('Failed to apply pathfinder preferences', error)
      }
    }

    applyPreferences()
  }, [])

  const persist = useCallback(
    (
      next: Partial<{
        armorManagerEnabled: boolean
        autoEatEnabled: boolean
        autoEatOptions: AutoEatOptions
        pathfinder: PathfinderOptions
      }>
    ) => {
      savePluginPreferences({
        armorManagerEnabled: next.armorManagerEnabled ?? armorManagerEnabled,
        autoEatEnabled: next.autoEatEnabled ?? autoEatEnabled,
        autoEatOptions: next.autoEatOptions ?? autoEatOptions,
        pathfinder: next.pathfinder ?? pathfinder,
      })
    },
    [armorManagerEnabled, autoEatEnabled, autoEatOptions, pathfinder]
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

  return {
    armorManagerEnabled,
    autoEatEnabled,
    autoEatOptions,
    toggleArmorManager,
    toggleAutoEat,
    updateAutoEatOptions,
    pathfinder,
    updatePathfinder,
  }
}

export default usePluginControls
